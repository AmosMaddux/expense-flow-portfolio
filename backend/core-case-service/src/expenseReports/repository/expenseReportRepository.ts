import { and, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    auditEntry,
    approvedWorkflowStages,
    expenseReport,
    type ExpenseReport,
    type NewExpenseReport,
    stageTransition,
} from "../../db/schema/expenseReport.js";
import type { TransitionExpenseReportStageRequest } from "../dto/expenseReportDto.js";

export const expenseReportCreatedReason = "report_created";
type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

const validTransitionEdges = new Set<string>([
    "Drafted->Submitted",
    "Submitted->Manager Approval",
    "Manager Approval->AP Review",
    "AP Review->Paid",
    "Paid->Reconciled",
    "Manager Approval->Drafted",
    "AP Review->Drafted",
]);

/**
 * Reads an Expense Report from the case store within a tenant boundary.
 */
export async function findExpenseReportById(
    tenantId: string,
    id: string,
    ownerId?: string,
): Promise<ExpenseReport | undefined> {
    const report: ExpenseReport[] = await db
        .select()
        .from(expenseReport)
        // Employee reads add owner scope; internal roles rely on the authenticated tenant boundary.
        .where(
            ownerId === undefined
                ? and(
                      eq(expenseReport.tenantId, tenantId),
                      eq(expenseReport.id, id),
                  )
                : and(
                      eq(expenseReport.tenantId, tenantId),
                      eq(expenseReport.id, id),
                      eq(expenseReport.owner, ownerId),
                  ),
        );

    if (report.length === 1 && report[0] !== undefined) {
        return report[0];
    }

    return undefined;
}

/**
 * Creates a Drafted Expense Report with its initial audit and stage-transition rows.
 */
export async function insertDraftExpenseReport(
    tenantId: string,
    newReport: NewExpenseReport,
    actorId: string = newReport.owner,
): Promise<ExpenseReport | undefined> {
    if (newReport.tenantId !== tenantId) {
        return undefined;
    }

    return db.transaction(async (transaction) => {
        const insertedReports = await transaction
            .insert(expenseReport)
            .values({
                ...newReport,
                currentStage: "Drafted",
            })
            .returning();
        const insertedReport = insertedReports[0];

        if (insertedReport === undefined) {
            return undefined;
        }

        await transaction.insert(auditEntry).values({
            tenantId: insertedReport.tenantId,
            expenseReportId: insertedReport.id,
            actorId,
            action: expenseReportCreatedReason,
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
        });

        await transaction.insert(stageTransition).values({
            expenseReportId: insertedReport.id,
            tenantId: insertedReport.tenantId,
            fromStage: "Drafted",
            toStage: "Drafted",
            actor: actorId,
            reason: expenseReportCreatedReason,
        });

        return insertedReport;
    });
}

/**
 * Transitions an Expense Report stage and writes the required audit records.
 */
export async function transitionExpenseReportStage(
    request: TransitionExpenseReportStageRequest,
): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const currentReport = await transaction
            .select({
                currentStage: expenseReport.currentStage,
            })
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                ),
            )
            .limit(1);
        const currentStage = currentReport[0]?.currentStage as
            | ExpenseReportStage
            | undefined;

        if (currentStage === undefined) {
            return false;
        }

        if (
            !isValidTransitionEdge(request) ||
            currentStage !== request.fromStage
        ) {
            await writeTransitionAuditEntry(
                transaction,
                request,
                currentStage,
                "transition_denied",
                buildTransitionDenialReason(request, currentStage),
            );

            return false;
        }

        const transitionedReports = await transaction
            .update(expenseReport)
            .set({
                currentStage: request.toStage,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                    eq(expenseReport.currentStage, request.fromStage),
                ),
            )
            .returning({ id: expenseReport.id });

        if (transitionedReports.length === 0) {
            await writeTransitionAuditEntry(
                transaction,
                request,
                currentStage,
                "transition_denied",
                buildTransitionDenialReason(request, currentStage),
            );

            return false;
        }

        await writeTransitionAuditEntry(
            transaction,
            request,
            currentStage,
            "transition_approved",
        );
        await transaction.insert(stageTransition).values({
            expenseReportId: request.id,
            tenantId: request.tenantId,
            fromStage: request.fromStage,
            toStage: request.toStage,
            actor: request.actor,
            reason: request.reason,
        });

        return true;
    });
}

type TransactionContext = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeTransitionAuditEntry(
    transaction: TransactionContext,
    request: TransitionExpenseReportStageRequest,
    stageBeforeAction: ExpenseReportStage,
    action: "transition_approved" | "transition_denied",
    denialReason?: string,
): Promise<void> {
    await transaction.insert(auditEntry).values({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        actorId: request.actor,
        action,
        stageBeforeAction,
        stageAfterProposedAction: request.toStage,
        denialReason,
    });
}

function isValidTransitionEdge(
    request: TransitionExpenseReportStageRequest,
): boolean {
    return validTransitionEdges.has(`${request.fromStage}->${request.toStage}`);
}

function buildTransitionDenialReason(
    request: TransitionExpenseReportStageRequest,
    currentStage: ExpenseReportStage,
): string {
    if (!isValidTransitionEdge(request)) {
        return `Invalid transition from ${request.fromStage} to ${request.toStage}.`;
    }

    return `Expense Report is in ${currentStage}, not ${request.fromStage}.`;
}
