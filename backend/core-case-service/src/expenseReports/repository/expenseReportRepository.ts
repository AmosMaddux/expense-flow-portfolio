import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    auditEntry,
    expenseReport,
    approvedWorkflowStages,
    type ExpenseReport,
    type NewExpenseReport,
    stageTransition,
    stageTransitionOutbox,
} from "../../db/schema/expenseReport.js";
import type { TransitionExpenseReportStageRequest } from "../../schemas/expense-report.schema.js";

export const expenseReportCreatedReason = "report_created";
type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

/**
 * Reads an Expense Report from the case store within a tenant boundary.
 */
export async function findExpenseReportById(
    id: string,
): Promise<ExpenseReport | undefined> {
    const report: ExpenseReport[] = await db
        .select()
        .from(expenseReport)
        .where(eq(expenseReport.id, id));

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
            actorId: insertedReport.owner,
            action: expenseReportCreatedReason,
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
        });

        await transaction.insert(stageTransition).values({
            expenseReportId: insertedReport.id,
            tenantId: insertedReport.tenantId,
            fromStage: "Drafted",
            toStage: "Drafted",
            actor: insertedReport.owner,
            reason: expenseReportCreatedReason,
        });

        return insertedReport;
    });
}

/**
 * Moves an Expense Report stage and records its outbound event intent atomically.
 */
export async function transitionExpenseReportStage(
    request: TransitionExpenseReportStageRequest,
): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const reports = await transaction
            .select({ currentStage: expenseReport.currentStage })
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                ),
            )
            .limit(1)
            .for("update");
        const currentStage = reports[0]?.currentStage as
            ExpenseReportStage | undefined;

        if (
            currentStage === undefined ||
            currentStage !== request.fromStage ||
            !isValidTransitionEdge(request.fromStage, request.toStage)
        ) {
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
            return false;
        }

        await transaction.insert(auditEntry).values({
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actor,
            action: "transition_approved",
            stageBeforeAction: request.fromStage,
            stageAfterProposedAction: request.toStage,
        });

        const stageTransitionId = randomUUID();
        const occurredAt = request.occurredAt ?? new Date();
        await transaction.insert(stageTransition).values({
            id: stageTransitionId,
            expenseReportId: request.id,
            tenantId: request.tenantId,
            fromStage: request.fromStage,
            toStage: request.toStage,
            actor: request.actor,
            reason: request.reason,
            occurredAt,
        });

        await transaction.insert(stageTransitionOutbox).values({
            id: request.eventId ?? randomUUID(),
            stageTransitionId,
            expenseReportId: request.id,
            tenantId: request.tenantId,
            correlationId: request.correlationId ?? randomUUID(),
            fromStage: request.fromStage,
            toStage: request.toStage,
            occurredAt,
            nextAttemptAt: occurredAt,
        });

        return true;
    });
}

function isValidTransitionEdge(
    fromStage: ExpenseReportStage,
    toStage: ExpenseReportStage,
): boolean {
    return (
        (fromStage === "Drafted" && toStage === "Submitted") ||
        (fromStage === "Submitted" && toStage === "Manager Approval") ||
        (fromStage === "Manager Approval" && toStage === "AP Review") ||
        (fromStage === "AP Review" && toStage === "Paid") ||
        (fromStage === "Paid" && toStage === "Reconciled") ||
        (fromStage === "Manager Approval" && toStage === "Drafted") ||
        (fromStage === "AP Review" && toStage === "Drafted")
    );
}
