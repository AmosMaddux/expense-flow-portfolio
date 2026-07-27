import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    attachmentMetadata,
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
    receiptMetadata,
    stageTransition,
} from "../../db/schema/expenseReport.js";
import type { GlCodingResponse } from "../../glCoding/glCodingClient.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";
import type {
    ApprovalQueueLineItemResponse,
    TransitionExpenseReportStageRequest,
} from "../dto/expenseReportDto.js";

export const expenseReportCreatedReason = "report_created";
export const expenseReportSubmittedReason = "report_submitted";
export const transitionDeniedReasonPrefix = "transition_denied:";
export const unclearedFlagTransitionDenialReason =
    "Expense Report has uncleared over-threshold line-item flags.";
export const unreviewedLineItemTransitionDenialReason =
    "Expense Report has line items that have not been reviewed.";

type ExpenseReportStage = (typeof approvedWorkflowStages)[number];
type SubmissionSourceKey = `${"line_item" | "mileage"}:${string}`;
type SubmissionSourceFingerprint = string;

type ClearExpenseReportFlagsResult =
    | { kind: "cleared"; clearedFlagCount: number }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

type ReviewExpenseReportLineItemResult =
    | { kind: "reviewed"; lineItem: ApprovalQueueLineItemResponse }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

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

type ApprovalQueueLineItemRow = {
    id: string;
    expenseReportId: string;
    merchant: string;
    amount: string | null;
    glCode: string | null;
    currentStage: string;
    flaggedLineItem: boolean;
    reviewAction: "approve" | "reject" | null;
    submissionId: string;
};

type ApprovalQueueMileageEntryRow = {
    id: string;
    expenseReportId: string;
    route: string;
    distance: string;
    mileageDate: string;
    amount: string | null;
    glCode: string | null;
    submissionId: string;
};

export type InsertMileageEntryResult =
    | { kind: "created"; entry: typeof mileageEntry.$inferSelect }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

export type AddDraftExpenseContentResult =
    | {
          kind: "created";
          lineItemIds: string[];
          receiptIds: string[];
      }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

export type DraftExpenseContent = {
    report: ExpenseReport;
    lineItems: (typeof lineItem.$inferSelect)[];
    receipts: (typeof receiptMetadata.$inferSelect)[];
    mileageEntries: (typeof mileageEntry.$inferSelect)[];
};

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
 * Reads latest-submission line items that can appear in the manager Approval Queue.
 */
export async function findApprovalQueueLineItems(
    tenantId: string,
): Promise<ApprovalQueueLineItemResponse[]> {
    const rows = await db
        .select({
            id: glCodingResult.sourceId,
            expenseReportId: glCodingResult.expenseReportId,
            merchant: lineItem.merchant,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            reviewAction: glCodingResult.lineItemReviewAction,
            submissionId: glCodingResult.submissionId,
        })
        .from(glCodingResult)
        .innerJoin(
            expenseReport,
            and(
                eq(expenseReport.tenantId, glCodingResult.tenantId),
                eq(expenseReport.id, glCodingResult.expenseReportId),
            ),
        )
        .innerJoin(
            lineItem,
            and(
                eq(lineItem.tenantId, glCodingResult.tenantId),
                eq(lineItem.id, glCodingResult.sourceId),
            ),
        )
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.sourceType, "line_item"),
                inArray(expenseReport.currentStage, [
                    "Submitted",
                    "Manager Approval",
                    "AP Review",
                ]),
            ),
        )
        .orderBy(
            asc(expenseReport.dueDate),
            desc(glCodingResult.codedAt),
            desc(glCodingResult.id),
        );

    const lineItemRows = rows as ApprovalQueueLineItemRow[];
    const latestSubmissionByReport =
        readLatestSubmissionByReport(lineItemRows);
    const mileageRows = await findApprovalQueueMileageEntries(
        tenantId,
        latestSubmissionByReport,
    );

    return toLatestApprovalQueueLineItems(lineItemRows, mileageRows);
}

/**
 * Reads the most recently updated Drafted Expense Report owned by an employee.
 */
export async function findCurrentDraftExpenseReport(
    tenantId: string,
    ownerId: string,
): Promise<ExpenseReport | undefined> {
    const reports = await db
        .select()
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.tenantId, tenantId),
                eq(expenseReport.owner, ownerId),
                eq(expenseReport.currentStage, "Drafted"),
            ),
        )
        .orderBy(
            desc(expenseReport.updatedAt),
            desc(expenseReport.createdAt),
            desc(expenseReport.id),
        )
        .limit(1);

    return reports[0];
}

/**
 * Reads saved content from an employee-owned Drafted Expense Report.
 */
export async function findDraftExpenseContent(
    tenantId: string,
    expenseReportId: string,
    ownerId: string,
): Promise<DraftExpenseContent | undefined> {
    const reports = await db
        .select()
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.tenantId, tenantId),
                eq(expenseReport.id, expenseReportId),
                eq(expenseReport.owner, ownerId),
                eq(expenseReport.currentStage, "Drafted"),
            ),
        )
        .limit(1);
    const report = reports[0];
    if (report === undefined) {
        return undefined;
    }

    const [savedLineItems, receipts, mileageEntries] = await Promise.all([
        db
            .select()
            .from(lineItem)
            .where(
                and(
                    eq(lineItem.tenantId, tenantId),
                    eq(lineItem.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(asc(lineItem.createdAt), asc(lineItem.id)),
        db
            .select()
            .from(receiptMetadata)
            .where(
                and(
                    eq(receiptMetadata.tenantId, tenantId),
                    eq(receiptMetadata.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(asc(receiptMetadata.createdAt), asc(receiptMetadata.id)),
        db
            .select()
            .from(mileageEntry)
            .where(
                and(
                    eq(mileageEntry.tenantId, tenantId),
                    eq(mileageEntry.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(asc(mileageEntry.createdAt), asc(mileageEntry.id)),
    ]);

    return {
        report,
        lineItems: savedLineItems,
        receipts,
        mileageEntries,
    };
}

/**
 * Adds a mileage entry to an employee-owned Drafted Expense Report.
 */
export async function insertMileageEntry(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    route: string;
    distance: string;
    mileageDate: string;
}): Promise<InsertMileageEntryResult> {
    return db.transaction(async (transaction) => {
        const reports = await transaction
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.expenseReportId),
                    eq(expenseReport.owner, request.ownerId),
                ),
            )
            .limit(1)
            .for("update");
        const report = reports[0];

        if (report === undefined) {
            return { kind: "not_found" };
        }

        if (report.currentStage !== "Drafted") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage as ExpenseReportStage,
            };
        }

        const insertedEntries = await transaction
            .insert(mileageEntry)
            .values({
                tenantId: request.tenantId,
                expenseReportId: request.expenseReportId,
                route: request.route,
                distance: request.distance,
                mileageDate: request.mileageDate,
            })
            .returning();
        const entry = insertedEntries[0];
        if (entry === undefined) {
            throw new Error("Unable to add mileage entry.");
        }

        await transaction
            .update(expenseReport)
            .set({ updatedAt: new Date() })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.expenseReportId),
                ),
            );
        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action: "mileage_entry_added",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
        });

        return { kind: "created", entry };
    });
}

/**
 * Adds validated line items and receipt references to an employee-owned draft.
 */
export async function insertDraftExpenseContent(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    lineItems: Array<{
        merchant: string;
        expenseDate: string;
        category: string;
        amount: number;
        currency: string;
    }>;
    receipts: Array<{
        lineItemIndex: number;
        filename: string;
        contentType: string;
        sizeBytes: number;
        blobReference: { objectKey: string };
    }>;
}): Promise<AddDraftExpenseContentResult> {
    return db.transaction(async (transaction) => {
        const reports = await transaction
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.expenseReportId),
                    eq(expenseReport.owner, request.ownerId),
                ),
            )
            .limit(1)
            .for("update");
        const report = reports[0];

        if (report === undefined) {
            return { kind: "not_found" };
        }
        if (report.currentStage !== "Drafted") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage as ExpenseReportStage,
            };
        }

        const insertedLineItems = await transaction
            .insert(lineItem)
            .values(
                request.lineItems.map((item) => ({
                    tenantId: request.tenantId,
                    expenseReportId: request.expenseReportId,
                    merchant: item.merchant,
                    expenseDate: item.expenseDate,
                    amount: item.amount.toFixed(2),
                    currency: item.currency,
                    category: item.category,
                })),
            )
            .returning({ id: lineItem.id });

        const receiptValues = request.receipts.map((receipt) => {
            const sourceLineItem = request.lineItems[receipt.lineItemIndex];
            if (sourceLineItem === undefined) {
                throw new Error("Receipt line item reference is invalid.");
            }

            return {
                tenantId: request.tenantId,
                expenseReportId: request.expenseReportId,
                merchant: sourceLineItem.merchant,
                receiptDate: sourceLineItem.expenseDate,
                amount: sourceLineItem.amount.toFixed(2),
                blobReference: {
                    ...receipt.blobReference,
                    filename: receipt.filename,
                    contentType: receipt.contentType,
                    sizeBytes: receipt.sizeBytes,
                },
            };
        });
        const insertedReceipts =
            receiptValues.length === 0
                ? []
                : await transaction
                      .insert(receiptMetadata)
                      .values(receiptValues)
                      .returning({ id: receiptMetadata.id });

        if (request.receipts.length > 0) {
            await transaction.insert(attachmentMetadata).values(
                request.receipts.map((receipt) => ({
                    tenantId: request.tenantId,
                    expenseReportId: request.expenseReportId,
                    filename: receipt.filename,
                    contentType: receipt.contentType,
                    blobReference: {
                        ...receipt.blobReference,
                        sizeBytes: receipt.sizeBytes,
                    },
                })),
            );
        }

        await transaction
            .update(expenseReport)
            .set({ updatedAt: new Date() })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.expenseReportId),
                ),
            );
        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action: "draft_expense_content_added",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
        });

        return {
            kind: "created",
            lineItemIds: insertedLineItems.map((item) => item.id),
            receiptIds: insertedReceipts.map((receipt) => receipt.id),
        };
    });
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
            .onConflictDoNothing({
                target: [expenseReport.tenantId, expenseReport.owner],
                where: sql`${expenseReport.currentStage} = 'Drafted'`,
            })
            .returning();
        const insertedReport = insertedReports[0];

        if (insertedReport === undefined) {
            const existingReports = await transaction
                .select()
                .from(expenseReport)
                .where(
                    and(
                        eq(expenseReport.tenantId, tenantId),
                        eq(expenseReport.owner, newReport.owner),
                        eq(expenseReport.currentStage, "Drafted"),
                    ),
                )
                .orderBy(
                    desc(expenseReport.updatedAt),
                    desc(expenseReport.createdAt),
                    desc(expenseReport.id),
                )
                .limit(1);

            return existingReports[0];
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
        const reports = await transaction
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.id, expenseReportId),
                ),
            )
            .limit(1)
            .for("update");
        const report = reports[0];
        if (report === undefined || report.currentStage !== "Drafted") {
            return undefined;
        }

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

        await writeDeniedTransitionLog(
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
            denialReason,
        );

        return true;
    });
}

/**
 * Records a denied workflow transition attempt without changing the report stage.
 */
export async function insertDeniedWorkflowTransitionAttempt(request: {
    tenantId: string;
    id: string;
    actor: string;
    toStage: ExpenseReportStage;
    denialReason: string;
}): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.id,
            true,
        );

        if (report === undefined) {
            return false;
        }

        await writeDeniedTransitionLog(
            transaction,
            {
                tenantId: request.tenantId,
                id: request.id,
                actor: request.actor,
                fromStage: report.currentStage,
                toStage: request.toStage,
                reason: transitionDeniedReasonPrefix,
            },
            report.currentStage,
            request.denialReason,
        );

        return true;
    });
}

/**
 * Records a denied flag-clear attempt without writing a workflow transition row.
 */
export async function insertDeniedFlagClearAuditEntry(request: {
    tenantId: string;
    expenseReportId: string;
    actorId: string;
    outcomeReason: string;
}): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.expenseReportId,
            true,
        );

        if (report === undefined) {
            return false;
        }

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action: "line_item_flags_clear_denied",
            stageBeforeAction: report.currentStage,
            stageAfterProposedAction: report.currentStage,
            outcomeReason: request.outcomeReason,
        });

        return true;
    });
}
/**
 * Counts uncleared line-item flags on an Expense Report.
 */
export async function countOpenExpenseReportFlags(
    tenantId: string,
    expenseReportId: string,
): Promise<number> {
    return db.transaction(async (transaction) =>
        countOpenExpenseReportFlagsInTransaction(
            transaction,
            tenantId,
            expenseReportId,
        ),
    );
}

/**
 * Clears line-item flags so Manager Approval can advance after review.
 */
export async function clearExpenseReportFlags(request: {
    tenantId: string;
    expenseReportId: string;
    actorId: string;
    sourceIds: string[];
    reason: string;
}): Promise<ClearExpenseReportFlagsResult> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.expenseReportId,
            true,
        );

        if (report === undefined) {
            return { kind: "not_found" };
        }

        if (report.currentStage !== "Manager Approval") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage,
            };
        }

        const latestSubmissionId = await readLatestSubmissionId(
            transaction,
            request.tenantId,
            request.expenseReportId,
        );

        if (latestSubmissionId === undefined) {
            return { kind: "cleared", clearedFlagCount: 0 };
        }

        const clearedRows = await transaction
            .update(glCodingResult)
            .set({
                flaggedLineItem: false,
                flagCode: null,
                flagMessage: null,
            })
            .where(
                and(
                    eq(glCodingResult.tenantId, request.tenantId),
                    eq(glCodingResult.expenseReportId, request.expenseReportId),
                    eq(glCodingResult.sourceType, "line_item"),
                    eq(glCodingResult.flaggedLineItem, true),
                    inArray(glCodingResult.sourceId, request.sourceIds),
                    eq(glCodingResult.submissionId, latestSubmissionId),
                ),
            )
            .returning({ id: glCodingResult.id });

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action: "line_item_flags_cleared",
            stageBeforeAction: report.currentStage,
            stageAfterProposedAction: report.currentStage,
            outcomeReason: request.reason,
        });

        return { kind: "cleared", clearedFlagCount: clearedRows.length };
    });
}

/**
 * Records a manager review decision for one line item in Manager Approval.
 */
export async function reviewExpenseReportLineItem(request: {
    tenantId: string;
    expenseReportId: string;
    sourceId: string;
    actorId: string;
    action: "approve" | "reject";
    reason?: string;
}): Promise<ReviewExpenseReportLineItemResult> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.expenseReportId,
            true,
        );

        if (report === undefined) {
            return { kind: "not_found" };
        }

        if (report.currentStage !== "Manager Approval") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage,
            };
        }

        const latestSubmissionId = await readLatestSubmissionId(
            transaction,
            request.tenantId,
            request.expenseReportId,
        );

        if (latestSubmissionId === undefined) {
            return { kind: "not_found" };
        }

        const reviewedAt = new Date();
        const reviewedRows = await transaction
            .update(glCodingResult)
            .set({
                lineItemReviewAction: request.action,
                lineItemReviewReason: request.reason ?? null,
                lineItemReviewedBy: request.actorId,
                lineItemReviewedAt: reviewedAt,
            })
            .where(
                and(
                    eq(glCodingResult.tenantId, request.tenantId),
                    eq(glCodingResult.expenseReportId, request.expenseReportId),
                    eq(glCodingResult.sourceType, "line_item"),
                    eq(glCodingResult.sourceId, request.sourceId),
                    eq(glCodingResult.submissionId, latestSubmissionId),
                ),
            )
            .returning({ id: glCodingResult.id });

        if (reviewedRows.length === 0) {
            return { kind: "not_found" };
        }

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action:
                request.action === "approve"
                    ? "line_item_approved"
                    : "line_item_rejected",
            stageBeforeAction: report.currentStage,
            stageAfterProposedAction: report.currentStage,
            outcomeReason: request.reason ?? null,
        });

        const lineItemRow = await readApprovalQueueLineItemInTransaction(
            transaction,
            request.tenantId,
            request.expenseReportId,
            request.sourceId,
            latestSubmissionId,
        );

        if (lineItemRow === undefined) {
            return { kind: "not_found" };
        }

        const openFlagCount = await countOpenExpenseReportFlagsInTransaction(
            transaction,
            request.tenantId,
            request.expenseReportId,
        );
        const unreviewedLineItemCount =
            await countUnreviewedLineItemsInTransaction(
                transaction,
                request.tenantId,
                request.expenseReportId,
            );

        return {
            kind: "reviewed",
            lineItem: toApprovalQueueLineItemResponse(
                lineItemRow,
                openFlagCount,
                unreviewedLineItemCount,
            ),
        };
    });
}

/**
 * Transitions an Expense Report stage and writes the required audit records.
 */
export async function transitionExpenseReportStage(
    request: TransitionExpenseReportStageRequest,
): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.id,
            true,
        );
        const currentStage = report?.currentStage;

        if (currentStage === undefined) {
            return false;
        }

        if (
            !isValidTransitionEdge(request) ||
            currentStage !== request.fromStage
        ) {
            await writeDeniedTransitionLog(
                transaction,
                request,
                currentStage,
                buildTransitionDenialReason(request, currentStage),
            );

            return false;
        }

        if (isManagerApprovalFlagGate(request)) {
            const openFlagCount =
                await countOpenExpenseReportFlagsInTransaction(
                    transaction,
                    request.tenantId,
                    request.id,
                );

            if (openFlagCount > 0) {
                await writeDeniedTransitionLog(
                    transaction,
                    request,
                    currentStage,
                    unclearedFlagTransitionDenialReason,
                );

                return false;
            }
        }

        if (isManagerApprovalLineItemReviewGate(request)) {
            const unreviewedLineItemCount =
                await countUnreviewedLineItemsInTransaction(
                    transaction,
                    request.tenantId,
                    request.id,
                );

            if (unreviewedLineItemCount > 0) {
                await writeDeniedTransitionLog(
                    transaction,
                    request,
                    currentStage,
                    unreviewedLineItemTransitionDenialReason,
                );

                return false;
            }
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
            await writeDeniedTransitionLog(
                transaction,
                request,
                currentStage,
                buildTransitionDenialReason(request, currentStage),
            );

            return false;
        }

        await writeTransitionAuditEntry(
            transaction,
            request,
            currentStage,
            isSendBackTransition(request)
                ? "transition_sent_back"
                : "transition_approved",
            undefined,
            isSendBackTransition(request) ? request.reason : undefined,
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

async function readCurrentReportForTransition(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
    lockForUpdate = false,
): Promise<{ currentStage: ExpenseReportStage } | undefined> {
    const query = transaction
        .select({
            currentStage: expenseReport.currentStage,
        })
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.tenantId, tenantId),
                eq(expenseReport.id, expenseReportId),
            ),
        )
        .limit(1);
    const currentReport = lockForUpdate
        ? await query.for("update")
        : await query;
    const currentStage = currentReport[0]?.currentStage as
        ExpenseReportStage | undefined;

    return currentStage === undefined ? undefined : { currentStage };
}

async function writeDeniedTransitionLog(
    transaction: TransactionContext,
    request: TransitionExpenseReportStageRequest,
    stageBeforeAction: ExpenseReportStage,
    denialReason: string,
): Promise<void> {
    await writeTransitionAuditEntry(
        transaction,
        request,
        stageBeforeAction,
        "transition_denied",
        denialReason,
    );
    await transaction.insert(stageTransition).values({
        expenseReportId: request.id,
        tenantId: request.tenantId,
        fromStage: stageBeforeAction,
        toStage: stageBeforeAction,
        actor: request.actor,
        reason: `${transitionDeniedReasonPrefix} ${denialReason}`,
    });
}

async function writeTransitionAuditEntry(
    transaction: TransactionContext,
    request: TransitionExpenseReportStageRequest,
    stageBeforeAction: ExpenseReportStage,
    action:
        "transition_approved" | "transition_denied" | "transition_sent_back",
    denialReason?: string,
    outcomeReason?: string,
): Promise<void> {
    await transaction.insert(auditEntry).values({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        actorId: request.actor,
        action,
        stageBeforeAction,
        stageAfterProposedAction: request.toStage,
        denialReason,
        outcomeReason,
    });
}

async function countOpenExpenseReportFlagsInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
): Promise<number> {
    const latestSubmissionId = await readLatestSubmissionId(
        transaction,
        tenantId,
        expenseReportId,
    );

    if (latestSubmissionId === undefined) {
        return 0;
    }

    const rows = await transaction
        .select({ id: glCodingResult.id })
        .from(glCodingResult)
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.expenseReportId, expenseReportId),
                eq(glCodingResult.submissionId, latestSubmissionId),
                eq(glCodingResult.sourceType, "line_item"),
                eq(glCodingResult.flaggedLineItem, true),
            ),
        );

    return rows.length;
}

async function countUnreviewedLineItemsInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
): Promise<number> {
    const latestSubmissionId = await readLatestSubmissionId(
        transaction,
        tenantId,
        expenseReportId,
    );

    if (latestSubmissionId === undefined) {
        return 0;
    }

    const rows = await transaction
        .select({ id: glCodingResult.id })
        .from(glCodingResult)
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.expenseReportId, expenseReportId),
                eq(glCodingResult.submissionId, latestSubmissionId),
                eq(glCodingResult.sourceType, "line_item"),
                isNull(glCodingResult.lineItemReviewAction),
            ),
        );

    return rows.length;
}

async function readApprovalQueueLineItemInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
    sourceId: string,
    submissionId: string,
): Promise<ApprovalQueueLineItemRow | undefined> {
    const rows = await transaction
        .select({
            id: glCodingResult.sourceId,
            expenseReportId: glCodingResult.expenseReportId,
            merchant: lineItem.merchant,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            reviewAction: glCodingResult.lineItemReviewAction,
            submissionId: glCodingResult.submissionId,
        })
        .from(glCodingResult)
        .innerJoin(
            expenseReport,
            and(
                eq(expenseReport.tenantId, glCodingResult.tenantId),
                eq(expenseReport.id, glCodingResult.expenseReportId),
            ),
        )
        .innerJoin(
            lineItem,
            and(
                eq(lineItem.tenantId, glCodingResult.tenantId),
                eq(lineItem.id, glCodingResult.sourceId),
            ),
        )
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.expenseReportId, expenseReportId),
                eq(glCodingResult.sourceType, "line_item"),
                eq(glCodingResult.sourceId, sourceId),
                eq(glCodingResult.submissionId, submissionId),
            ),
        )
        .limit(1);

    return rows[0] as ApprovalQueueLineItemRow | undefined;
}

function readLatestSubmissionByReport(
    rows: ApprovalQueueLineItemRow[],
): Map<string, string> {
    const latestSubmissionByReport = new Map<string, string>();
    for (const row of rows) {
        if (!latestSubmissionByReport.has(row.expenseReportId)) {
            latestSubmissionByReport.set(row.expenseReportId, row.submissionId);
        }
    }

    return latestSubmissionByReport;
}

async function findApprovalQueueMileageEntries(
    tenantId: string,
    latestSubmissionByReport: Map<string, string>,
): Promise<ApprovalQueueMileageEntryRow[]> {
    const reportIds = [...latestSubmissionByReport.keys()];
    if (reportIds.length === 0) {
        return [];
    }

    const rows = await db
        .select({
            id: glCodingResult.sourceId,
            expenseReportId: glCodingResult.expenseReportId,
            route: mileageEntry.route,
            distance: mileageEntry.distance,
            mileageDate: mileageEntry.mileageDate,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            submissionId: glCodingResult.submissionId,
        })
        .from(glCodingResult)
        .innerJoin(
            mileageEntry,
            and(
                eq(mileageEntry.tenantId, glCodingResult.tenantId),
                eq(mileageEntry.id, glCodingResult.sourceId),
            ),
        )
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.sourceType, "mileage"),
                inArray(glCodingResult.expenseReportId, reportIds),
            ),
        )
        .orderBy(asc(mileageEntry.mileageDate), asc(glCodingResult.id));

    return (rows as ApprovalQueueMileageEntryRow[]).filter(
        (row) =>
            latestSubmissionByReport.get(row.expenseReportId) ===
            row.submissionId,
    );
}

function toLatestApprovalQueueLineItems(
    rows: ApprovalQueueLineItemRow[],
    mileageRows: ApprovalQueueMileageEntryRow[],
): ApprovalQueueLineItemResponse[] {
    const latestSubmissionByReport = readLatestSubmissionByReport(rows);
    const mileageEntriesByReport = groupApprovalQueueMileageEntries(
        mileageRows,
    );

    const openFlagCounts = new Map<string, number>();
    const unreviewedLineItemCounts = new Map<string, number>();
    for (const row of rows) {
        if (
            latestSubmissionByReport.get(row.expenseReportId) ===
                row.submissionId &&
            row.flaggedLineItem
        ) {
            openFlagCounts.set(
                row.expenseReportId,
                (openFlagCounts.get(row.expenseReportId) ?? 0) + 1,
            );
        }

        if (
            latestSubmissionByReport.get(row.expenseReportId) ===
                row.submissionId &&
            row.reviewAction === null
        ) {
            unreviewedLineItemCounts.set(
                row.expenseReportId,
                (unreviewedLineItemCounts.get(row.expenseReportId) ?? 0) + 1,
            );
        }
    }

    return rows
        .filter(
            (row) =>
                latestSubmissionByReport.get(row.expenseReportId) ===
                row.submissionId,
        )
        .map((row) =>
            toApprovalQueueLineItemResponse(
                row,
                openFlagCounts.get(row.expenseReportId) ?? 0,
                unreviewedLineItemCounts.get(row.expenseReportId) ?? 0,
                mileageEntriesByReport.get(row.expenseReportId) ?? [],
            ),
        );
}

function toApprovalQueueLineItemResponse(
    row: ApprovalQueueLineItemRow,
    openFlagCount: number,
    unreviewedLineItemCount: number,
    mileageEntries: ApprovalQueueMileageEntryRow[] = [],
): ApprovalQueueLineItemResponse {
    return {
        id: row.id,
        expenseReportId: row.expenseReportId,
        merchant: row.merchant,
        amount: Number(row.amount ?? 0),
        glCode: row.glCode ?? "Unmapped",
        currentStage: row.currentStage as ExpenseReportStage,
        flaggedLineItem: row.flaggedLineItem,
        reviewAction: row.reviewAction,
        canAdvance:
            row.currentStage === "Manager Approval" &&
            openFlagCount === 0 &&
            unreviewedLineItemCount === 0,
        mileageEntries: mileageEntries.map(toApprovalQueueMileageEntryResponse),
    };
}

function groupApprovalQueueMileageEntries(
    mileageRows: ApprovalQueueMileageEntryRow[],
): Map<string, ApprovalQueueMileageEntryRow[]> {
    const mileageEntriesByReport = new Map<
        string,
        ApprovalQueueMileageEntryRow[]
    >();

    for (const row of mileageRows) {
        const reportMileage = mileageEntriesByReport.get(row.expenseReportId);
        if (reportMileage === undefined) {
            mileageEntriesByReport.set(row.expenseReportId, [row]);
        } else {
            reportMileage.push(row);
        }
    }

    return mileageEntriesByReport;
}

function toApprovalQueueMileageEntryResponse(
    row: ApprovalQueueMileageEntryRow,
) {
    return {
        id: row.id,
        expenseReportId: row.expenseReportId,
        route: row.route,
        distance: Number(row.distance),
        mileageDate: row.mileageDate,
        amount: Number(row.amount ?? 0),
        glCode: row.glCode ?? "Unmapped",
    };
}

async function readLatestSubmissionId(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
): Promise<string | undefined> {
    const rows = await transaction
        .select({ submissionId: glCodingResult.submissionId })
        .from(glCodingResult)
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.expenseReportId, expenseReportId),
            ),
        )
        .orderBy(desc(glCodingResult.codedAt), desc(glCodingResult.id))
        .limit(1);

    return rows[0]?.submissionId;
}

function isManagerApprovalFlagGate(
    request: TransitionExpenseReportStageRequest,
): boolean {
    return (
        request.fromStage === "Manager Approval" &&
        request.toStage === "AP Review"
    );
}

function isManagerApprovalLineItemReviewGate(
    request: TransitionExpenseReportStageRequest,
): boolean {
    return (
        request.fromStage === "Manager Approval" &&
        (request.toStage === "AP Review" || request.toStage === "Drafted")
    );
}

function isSendBackTransition(
    request: TransitionExpenseReportStageRequest,
): boolean {
    return (
        request.toStage === "Drafted" &&
        (request.fromStage === "Manager Approval" ||
            request.fromStage === "AP Review")
    );
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
        .orderBy(asc(auditEntry.sequence));
}
