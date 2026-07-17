import { and, asc, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    auditEntry,
    approvedWorkflowStages,
    type AuditEntry,
    expenseReport,
    type ExpenseReport,
    glCodingResult,
    lineItem,
    mileageEntry,
    type NewAuditEntry,
    type NewExpenseReport,
    type NewGlCodingResult,
    stageTransition,
} from "../../db/schema/expenseReport.js";
import type { GlCodingResponse } from "../../glCoding/glCodingClient.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";
import type { TransitionExpenseReportStageRequest } from "../dto/expenseReportDto.js";

export const expenseReportCreatedReason = "report_created";
export const expenseReportSubmittedReason = "report_submitted";

type ExpenseReportStage = (typeof approvedWorkflowStages)[number];
type SubmissionSourceKey = `${"line_item" | "mileage"}:${string}`;
type SubmissionSourceFingerprint = string;

const validTransitionEdges = new Set<string>([
    "Drafted->Submitted",
    "Submitted->Manager Approval",
    "Manager Approval->AP Review",
    "AP Review->Paid",
    "Paid->Reconciled",
    "Manager Approval->Drafted",
    "AP Review->Drafted",
]);

export type SubmissionSources = {
    report: ExpenseReport;
    lineItems: Array<{
        id: string;
        merchant: string;
        amount: string;
        currency: string;
        category: string;
    }>;
    mileageEntries: Array<{
        id: string;
        route: string;
        distance: string;
        mileageDate: string;
    }>;
};

export type SubmissionSources = {
    report: ExpenseReport;
    lineItems: Array<{
        id: string;
        merchant: string;
        amount: string;
        currency: string;
        category: string;
    }>;
    mileageEntries: Array<{
        id: string;
        route: string;
        distance: string;
        mileageDate: string;
    }>;
};

type AuditEntryWriteClient = Pick<typeof db, "insert">;

type ExpenseReportTransaction = Parameters<
    Parameters<typeof db.transaction>[0]
>[0];

/**
 * Appends a redacted audit event using the caller's state-change transaction.
 */
async function appendAuditEntry(
    transaction: ExpenseReportTransaction,
    event: NewAuditEntry,
): Promise<void> {
    await transaction.insert(auditEntry).values(event);
}

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

        await appendAuditEntry(transaction, {
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
 * Reads the Drafted report and reimbursable sources needed for submission.
 */
export async function readDraftSubmissionSources(
    tenantId: string,
    expenseReportId: string,
): Promise<SubmissionSources | undefined> {
    const report = await findExpenseReportById(tenantId, expenseReportId);
    if (report === undefined || report.currentStage !== "Drafted") {
        return undefined;
    }

    const [lineItems, mileageEntries] = await Promise.all([
        db
            .select()
            .from(lineItem)
            .where(
                and(
                    eq(lineItem.tenantId, tenantId),
                    eq(lineItem.expenseReportId, expenseReportId),
                ),
            ),
        db
            .select()
            .from(mileageEntry)
            .where(
                and(
                    eq(mileageEntry.tenantId, tenantId),
                    eq(mileageEntry.expenseReportId, expenseReportId),
                ),
            ),
    ]);

    return { report, lineItems, mileageEntries };
}

/**
 * Appends GL-coding results and advances a Drafted report to Submitted.
 */
export async function submitDraftExpenseReport(
    tenantId: string,
    expenseReportId: string,
    actorId: string,
    submissionId: string,
    glCodingResponse: GlCodingResponse,
    expectedSourceKeys: Set<SubmissionSourceKey>,
    expectedSourceFingerprint: SubmissionSourceFingerprint,
): Promise<ExpenseReport | undefined> {
    return db.transaction(async (transaction) => {
        const [lineItems, mileageEntries] = await Promise.all([
            transaction
                .select()
                .from(lineItem)
                .where(
                    and(
                        eq(lineItem.tenantId, tenantId),
                        eq(lineItem.expenseReportId, expenseReportId),
                    ),
                ),
            transaction
                .select()
                .from(mileageEntry)
                .where(
                    and(
                        eq(mileageEntry.tenantId, tenantId),
                        eq(mileageEntry.expenseReportId, expenseReportId),
                    ),
                ),
        ]);
        const currentSources = {
            lineItems,
            mileageEntries,
        };
        const currentSourceKeys = buildSubmissionSourceKeys(currentSources);
        assertSourceKeysEqual(expectedSourceKeys, currentSourceKeys);
        assertSourceFingerprintEqual(
            expectedSourceFingerprint,
            buildSubmissionSourceFingerprint(currentSources),
        );
        validateGlCodingResponse(glCodingResponse, currentSourceKeys);

        const updatedReports = await transaction
            .update(expenseReport)
            .set({ currentStage: "Submitted", updatedAt: new Date() })
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.id, expenseReportId),
                    eq(expenseReport.currentStage, "Drafted"),
                ),
            )
            .returning();
        const updatedReport = updatedReports[0];
        if (updatedReport === undefined) {
            return undefined;
        }

        const flagsBySource = new Map(
            glCodingResponse.flags.map((flag) => [
                `${flag.source_type}:${flag.source_id}`,
                flag,
            ]),
        );
        const resultRows: NewGlCodingResult[] =
            glCodingResponse.coded_items.map((item) => {
                const flag = flagsBySource.get(
                    `${item.source_type}:${item.source_id}`,
                );

                return {
                    submissionId,
                    tenantId,
                    expenseReportId,
                    sourceType: item.source_type,
                    sourceId: item.source_id,
                    category: item.category,
                    mappingStatus: item.mapping_status,
                    glAccountCode: item.gl_account?.account_code ?? null,
                    glAccountName: item.gl_account?.account_name ?? null,
                    amount: item.amount ?? null,
                    currency: item.currency ?? null,
                    flaggedLineItem: item.flagged_line_item,
                    flagCode: flag?.code ?? null,
                    flagMessage: flag?.message ?? null,
                };
            });

        if (resultRows.length > 0) {
            await transaction.insert(glCodingResult).values(resultRows);
        }

        await writeTransitionAuditEntry(
            transaction,
            {
                tenantId,
                id: expenseReportId,
                actor: actorId,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: expenseReportSubmittedReason,
            },
            "Drafted",
            "transition_approved",
        );
        await transaction.insert(stageTransition).values({
            tenantId,
            expenseReportId,
            actor: actorId,
            fromStage: "Drafted",
            toStage: "Submitted",
            reason: expenseReportSubmittedReason,
        });

        return updatedReport;
    });
}

/**
 * Records a denied submission attempt for a report in the authenticated tenant.
 */
export async function insertDeniedSubmissionAuditEntry(
    tenantId: string,
    expenseReportId: string,
    actorId: string,
    denialReason: string,
): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const reports = await transaction
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.id, expenseReportId),
                ),
            );
        const report = reports[0];
        if (report === undefined) {
            return false;
        }

        await writeTransitionAuditEntry(
            transaction,
            {
                tenantId,
                id: expenseReportId,
                actor: actorId,
                fromStage: report.currentStage as ExpenseReportStage,
                toStage: "Submitted",
                reason: expenseReportSubmittedReason,
            },
            report.currentStage as ExpenseReportStage,
            "transition_denied",
            denialReason,
        );

        return true;
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

/**
 * Builds the expected GL-coding source set for one submission attempt.
 */
export function buildSubmissionSourceKeys(sources: {
    lineItems: Array<{ id: string }>;
    mileageEntries: Array<{ id: string }>;
}): Set<SubmissionSourceKey> {
    return new Set<SubmissionSourceKey>([
        ...sources.lineItems.map(
            (item): SubmissionSourceKey => `line_item:${item.id}`,
        ),
        ...sources.mileageEntries.map(
            (entry): SubmissionSourceKey => `mileage:${entry.id}`,
        ),
    ]);
}

/**
 * Builds a stable fingerprint of every source field submitted for GL coding.
 */
export function buildSubmissionSourceFingerprint(sources: {
    lineItems: Array<{
        id: string;
        merchant: string;
        amount: string;
        currency: string;
        category: string;
    }>;
    mileageEntries: Array<{
        id: string;
        route: string;
        distance: string;
        mileageDate: string;
    }>;
}): SubmissionSourceFingerprint {
    return JSON.stringify({
        lineItems: sources.lineItems
            .map((item) => ({
                id: item.id,
                merchant: item.merchant,
                amount: item.amount,
                currency: item.currency,
                category: item.category,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        mileageEntries: sources.mileageEntries
            .map((entry) => ({
                id: entry.id,
                route: entry.route,
                distance: entry.distance,
                mileageDate: entry.mileageDate,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
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

function validateGlCodingResponse(
    glCodingResponse: GlCodingResponse,
    expectedSourceKeys: Set<SubmissionSourceKey>,
): void {
    const seenSourceKeys = new Set<SubmissionSourceKey>();
    for (const item of glCodingResponse.coded_items) {
        const sourceKey: SubmissionSourceKey = `${item.source_type}:${item.source_id}`;
        if (!expectedSourceKeys.has(sourceKey)) {
            throw invalidGlCodingResponseError(
                "The GL-coding service returned a result for an unexpected source.",
            );
        }

        if (seenSourceKeys.has(sourceKey)) {
            throw invalidGlCodingResponseError(
                "The GL-coding service returned duplicate results for a source.",
            );
        }

        if (item.mapping_status === "mapped" && item.gl_account === null) {
            throw invalidGlCodingResponseError(
                "The GL-coding service returned a mapped result without a GL account.",
            );
        }

        if (item.mapping_status === "unmapped" && item.gl_account !== null) {
            throw invalidGlCodingResponseError(
                "The GL-coding service returned an unmapped result with a GL account.",
            );
        }

        seenSourceKeys.add(sourceKey);
    }

    for (const sourceKey of expectedSourceKeys) {
        if (!seenSourceKeys.has(sourceKey)) {
            throw invalidGlCodingResponseError(
                "The GL-coding service did not return results for every submitted source.",
            );
        }
    }

    for (const flag of glCodingResponse.flags) {
        const sourceKey: SubmissionSourceKey = `${flag.source_type}:${flag.source_id}`;
        if (!seenSourceKeys.has(sourceKey)) {
            throw invalidGlCodingResponseError(
                "The GL-coding service returned a flag for an unknown source.",
            );
        }
    }
}

function assertSourceFingerprintEqual(
    expectedSourceFingerprint: SubmissionSourceFingerprint,
    currentSourceFingerprint: SubmissionSourceFingerprint,
): void {
    if (expectedSourceFingerprint !== currentSourceFingerprint) {
        throw invalidGlCodingResponseError(
            "Expense Report sources changed during submission.",
        );
    }
}

function assertSourceKeysEqual(
    expectedSourceKeys: Set<SubmissionSourceKey>,
    currentSourceKeys: Set<SubmissionSourceKey>,
): void {
    if (expectedSourceKeys.size !== currentSourceKeys.size) {
        throw invalidGlCodingResponseError(
            "Expense Report sources changed during submission.",
        );
    }

    for (const sourceKey of expectedSourceKeys) {
        if (!currentSourceKeys.has(sourceKey)) {
            throw invalidGlCodingResponseError(
                "Expense Report sources changed during submission.",
            );
        }
    }
}

function invalidGlCodingResponseError(message: string): GlCodingServiceError {
    return new GlCodingServiceError(message);
}

/**
 * Reads append-only audit events for an Expense Report within a tenant boundary.
 */
export async function findAuditEntriesByExpenseReportId(
    tenantId: string,
    expenseReportId: string,
): Promise<AuditEntry[]> {
    return db
        .select()
        .from(auditEntry)
        .where(
            and(
                eq(auditEntry.tenantId, tenantId),
                eq(auditEntry.expenseReportId, expenseReportId),
            ),
        )
        .orderBy(asc(auditEntry.createdAt), asc(auditEntry.sequence));
}
