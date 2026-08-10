import { randomUUID } from "node:crypto";

import {
    and,
    asc,
    desc,
    eq,
    inArray,
    isNull,
    lt,
    notExists,
    or,
} from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    attachmentMetadata,
    auditEntry,
    approvedWorkflowStages,
    type AuditEntry,
    caseComment,
    type CaseComment,
    expenseReport,
    type ExpenseReport,
    expenseReportSettlement,
    type ExpenseReportSettlement,
    glCodingResult,
    lineItem,
    mileageEntry,
    type NewAuditEntry,
    type NewCaseComment,
    type NewExpenseReport,
    type NewGlCodingResult,
    receiptMetadata,
    stageTransition,
    stageTransitionOutbox,
} from "../../db/schema/expenseReport.js";
import type { GlCodingResponse } from "../../glCoding/glCodingClient.js";
import type { EinValidationResult } from "../../tinEin/tinEinValidationAcl.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";
import type {
    ApprovalQueueLineItemResponse,
    ExpenseReportReviewDetail,
    TransitionExpenseReportStageRequest,
} from "../dto/expenseReportDto.js";
import { isExpenseReportWorkflowEdge } from "../domain/expenseReportWorkflow.js";

export const expenseReportCreatedReason = "report_created";
export const expenseReportSubmittedReason = "report_submitted";
export const transitionDeniedReasonPrefix = "transition_denied:";
export const unclearedFlagTransitionDenialReason =
    "Expense Report has uncleared over-threshold line-item flags.";
export const unreviewedLineItemTransitionDenialReason =
    "Expense Report has reviewable sources that have not been reviewed.";

type ExpenseReportStage = (typeof approvedWorkflowStages)[number];
type SubmissionSourceKey = `${"line_item" | "mileage"}:${string}`;
type ReviewableExpenseSourceType = "line_item" | "mileage";
type SubmissionSourceFingerprint = string;
type StageTransitionEventContext = {
    correlationId: string;
    eventId: string;
    idempotencyKey?: string;
    requestHash?: string;
    occurredAt: Date;
};

export type SettlementSagaCompensationResult =
    | { kind: "compensated"; eventId: string }
    | { kind: "already_prior_stage" }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

export type SettlementClaimResult =
    | { kind: "issue_payment"; settlement: ExpenseReportSettlement }
    | { kind: "reuse_payment"; settlement: ExpenseReportSettlement }
    | {
          kind: "already_reconciled";
          settlement: ExpenseReportSettlement;
          report: ExpenseReport;
      }
    | { kind: "in_progress"; settlement: ExpenseReportSettlement }
    | { kind: "terminal_compensated"; settlement: ExpenseReportSettlement }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

export type SettlementPaymentRecordResult =
    | { kind: "recorded"; settlement: ExpenseReportSettlement }
    | { kind: "already_recorded"; settlement: ExpenseReportSettlement }
    | { kind: "not_found" };

export type AbandonSettlementClaimResult =
    { kind: "abandoned" } | { kind: "not_abandoned" };

type EmployerEinValidationForSubmission = {
    ein: string;
    legalName: string;
    result: EinValidationResult;
    validatedAt: Date;
} | null;

type ClearExpenseReportFlagsResult =
    | { kind: "cleared"; clearedFlagCount: number }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

type ReviewExpenseReportLineItemResult =
    | { kind: "reviewed"; lineItem: ApprovalQueueLineItemResponse }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

type UpdateExpenseReportSourceDeductibilityResult =
    | { kind: "updated"; lineItem: ApprovalQueueLineItemResponse }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

type LatestReportGlResult = {
    sourceType: ReviewableExpenseSourceType;
    sourceId: string;
    glCode: string | null;
    amount: string | null;
    currency: string | null;
    flaggedLineItem: boolean;
    reviewAction: "approve" | "reject" | null;
    deductible: boolean;
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

type ApprovalQueueLineItemRow = {
    id: string;
    sourceType: "line_item" | "mileage";
    expenseReportId: string;
    employee: string;
    merchant: string;
    amount: string | null;
    glCode: string | null;
    mileageDistance?: string;
    currentStage: string;
    flaggedLineItem: boolean;
    flagCode: string | null;
    flagMessage: string | null;
    reviewAction: "approve" | "reject" | null;
    deductible: boolean;
    submissionId: string;
    codedAt: Date;
    codingResultId: string;
};

type ApprovalQueueMileageEntryRow = {
    id: string;
    sourceType: "mileage";
    expenseReportId: string;
    employee: string;
    route: string;
    distance: string;
    mileageDate: string;
    amount: string | null;
    glCode: string | null;
    currentStage: string;
    flaggedLineItem: boolean;
    flagCode: string | null;
    flagMessage: string | null;
    reviewAction: "approve" | "reject" | null;
    deductible: boolean;
    submissionId: string;
    codedAt: Date;
    codingResultId: string;
};

type ApprovalQueueReceiptRow = {
    id: string;
    expenseReportId: string;
    lineItemId: string | null;
    merchant: string;
    receiptDate: string;
    amount: string;
    blobReference: unknown;
};

export type ReceiptFileMetadata = {
    id: string;
    expenseReportId: string;
    filename: string | null;
    contentType: string | null;
    objectKey: string;
    sizeBytes: number | null;
};

export type InsertMileageEntryResult =
    | { kind: "created"; entry: typeof mileageEntry.$inferSelect }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" };

export type ModifyDraftSourceResult =
    | { kind: "modified" }
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

export type EmployeeSubmissionDetailContent = {
    report: ExpenseReport;
    rejectionReason: string | null;
    lineItems: Array<
        typeof lineItem.$inferSelect & {
            reviewAction: "approve" | "reject" | null;
        }
    >;
    mileageEntries: Array<
        typeof mileageEntry.$inferSelect & {
            reviewAction: "approve" | "reject" | null;
        }
    >;
};

export type EmployeeSubmissionSummary = ExpenseReport & {
    isSentBack: boolean;
};

export type ExpenseReportOwnerCursor = {
    updatedAt: Date;
    createdAt: Date;
    id: string;
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
 * Reads full report detail sources inside the authenticated tenant boundary.
 */
export async function findExpenseReportReviewDetail(
    tenantId: string,
    expenseReportId: string,
): Promise<ExpenseReportReviewDetail | undefined> {
    const report = await findExpenseReportById(tenantId, expenseReportId);
    if (report === undefined) {
        return undefined;
    }

    const [savedLineItems, savedMileageEntries, glRows, receiptRows] =
        await Promise.all([
            db
                .select()
                .from(lineItem)
                .where(
                    and(
                        eq(lineItem.tenantId, tenantId),
                        eq(lineItem.expenseReportId, expenseReportId),
                    ),
                )
                .orderBy(asc(lineItem.expenseDate), asc(lineItem.id)),
            db
                .select()
                .from(mileageEntry)
                .where(
                    and(
                        eq(mileageEntry.tenantId, tenantId),
                        eq(mileageEntry.expenseReportId, expenseReportId),
                    ),
                )
                .orderBy(asc(mileageEntry.mileageDate), asc(mileageEntry.id)),
            db
                .select({
                    sourceType: glCodingResult.sourceType,
                    sourceId: glCodingResult.sourceId,
                    glCode: glCodingResult.glAccountCode,
                    amount: glCodingResult.amount,
                    currency: glCodingResult.currency,
                    flaggedLineItem: glCodingResult.flaggedLineItem,
                    reviewAction: glCodingResult.lineItemReviewAction,
                    deductible: glCodingResult.deductible,
                })
                .from(glCodingResult)
                .where(
                    and(
                        eq(glCodingResult.tenantId, tenantId),
                        eq(glCodingResult.expenseReportId, expenseReportId),
                    ),
                )
                .orderBy(desc(glCodingResult.codedAt), desc(glCodingResult.id)),
            findApprovalQueueReceipts(tenantId, [expenseReportId]),
        ]);
    const latestGlBySource = new Map<string, LatestReportGlResult>();
    for (const row of glRows) {
        if (row.sourceType !== "line_item" && row.sourceType !== "mileage") {
            continue;
        }

        const sourceKey = `${row.sourceType}:${row.sourceId}`;
        if (!latestGlBySource.has(sourceKey)) {
            latestGlBySource.set(sourceKey, {
                sourceType: row.sourceType,
                sourceId: row.sourceId,
                glCode: row.glCode,
                amount: row.amount,
                currency: row.currency,
                flaggedLineItem: row.flaggedLineItem,
                reviewAction: parseReviewAction(row.reviewAction),
                deductible: row.deductible,
            });
        }
    }

    return {
        expenseReportId: report.id,
        owner: report.owner,
        priority: report.priority as ExpenseReportReviewDetail["priority"],
        dueDate: report.dueDate,
        status: report.currentStage as ExpenseReportReviewDetail["status"],
        onHold: report.onHold,
        isOverdue: false,
        lineItems: savedLineItems.map((item) => {
            const latestGl = latestGlBySource.get(`line_item:${item.id}`);

            return {
                id: item.id,
                merchant: item.merchant,
                category: item.category,
                date: item.expenseDate,
                amount: item.amount,
                currency: item.currency,
                glCode: latestGl?.glCode ?? null,
                flaggedLineItem: latestGl?.flaggedLineItem ?? false,
                reviewAction: latestGl?.reviewAction ?? null,
                deductible: latestGl?.deductible ?? null,
            };
        }),
        mileageEntries: savedMileageEntries.map((entry) => {
            const latestGl = latestGlBySource.get(`mileage:${entry.id}`);

            return {
                id: entry.id,
                route: entry.route,
                distance: entry.distance,
                date: entry.mileageDate,
                amount: latestGl?.amount ?? "0.00",
                currency: latestGl?.currency ?? "USD",
                glCode: latestGl?.glCode ?? null,
                flaggedLineItem: latestGl?.flaggedLineItem ?? false,
                reviewAction: latestGl?.reviewAction ?? null,
                deductible: latestGl?.deductible ?? null,
            };
        }),
        receipts: receiptRows.map(toApprovalQueueReceiptResponse),
    };
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
            sourceType: glCodingResult.sourceType,
            expenseReportId: glCodingResult.expenseReportId,
            employee: expenseReport.owner,
            merchant: lineItem.merchant,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            flagCode: glCodingResult.flagCode,
            flagMessage: glCodingResult.flagMessage,
            reviewAction: glCodingResult.lineItemReviewAction,
            deductible: glCodingResult.deductible,
            submissionId: glCodingResult.submissionId,
            codedAt: glCodingResult.codedAt,
            codingResultId: glCodingResult.id,
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
    const mileageRows = await findApprovalQueueMileageEntries(tenantId);
    const reportIds = [
        ...new Set(
            [...lineItemRows, ...mileageRows].map((row) => row.expenseReportId),
        ),
    ];
    const receiptRows =
        reportIds.length === 0
            ? []
            : await findApprovalQueueReceipts(tenantId, reportIds);

    return toLatestApprovalQueueLineItems(
        lineItemRows,
        mileageRows,
        receiptRows,
    );
}

/**
 * Reads tenant-scoped receipt object metadata for authenticated file access.
 */
export async function findReceiptFileMetadata(
    tenantId: string,
    expenseReportId: string,
    receiptId: string,
): Promise<ReceiptFileMetadata | undefined> {
    const rows = await db
        .select({
            id: receiptMetadata.id,
            expenseReportId: receiptMetadata.expenseReportId,
            blobReference: receiptMetadata.blobReference,
        })
        .from(receiptMetadata)
        .where(
            and(
                eq(receiptMetadata.tenantId, tenantId),
                eq(receiptMetadata.expenseReportId, expenseReportId),
                eq(receiptMetadata.id, receiptId),
            ),
        )
        .limit(1);
    const row = rows[0];
    if (row === undefined) {
        return undefined;
    }

    const objectKey = readReceiptBlobString(row.blobReference, "objectKey");
    if (objectKey === null) {
        return undefined;
    }

    return {
        id: row.id,
        expenseReportId: row.expenseReportId,
        filename: readReceiptBlobString(row.blobReference, "filename"),
        contentType: readReceiptBlobString(row.blobReference, "contentType"),
        objectKey,
        sizeBytes: readReceiptBlobNumber(row.blobReference, "sizeBytes"),
    };
}

/**
 * Reads the most recently updated Drafted Expense Report owned by an employee.
 */
export async function findCurrentDraftExpenseReport(
    tenantId: string,
    ownerId: string,
): Promise<ExpenseReport | undefined> {
    const sentBackAuditRows = db
        .select({ id: auditEntry.id })
        .from(auditEntry)
        .where(
            and(
                eq(auditEntry.tenantId, expenseReport.tenantId),
                eq(auditEntry.expenseReportId, expenseReport.id),
                eq(auditEntry.action, "transition_sent_back"),
            ),
        );
    const workingDrafts = await db
        .select()
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.tenantId, tenantId),
                eq(expenseReport.owner, ownerId),
                eq(expenseReport.currentStage, "Drafted"),
                notExists(sentBackAuditRows),
            ),
        )
        .orderBy(
            desc(expenseReport.updatedAt),
            desc(expenseReport.createdAt),
            desc(expenseReport.id),
        )
        .limit(1);

    if (workingDrafts[0] !== undefined) {
        return workingDrafts[0];
    }

    const returnedDrafts = await db
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

    return returnedDrafts[0];
}

/**
 * Reads every Expense Report owned by one employee within one tenant.
 */
export async function findExpenseReportsByOwner(
    tenantId: string,
    ownerId: string,
    pagination: {
        cursor?: ExpenseReportOwnerCursor;
        limit: number;
    } = { limit: 26 },
): Promise<EmployeeSubmissionSummary[]> {
    const cursorCondition =
        pagination.cursor === undefined
            ? undefined
            : or(
                  lt(expenseReport.updatedAt, pagination.cursor.updatedAt),
                  and(
                      eq(expenseReport.updatedAt, pagination.cursor.updatedAt),
                      lt(expenseReport.createdAt, pagination.cursor.createdAt),
                  ),
                  and(
                      eq(expenseReport.updatedAt, pagination.cursor.updatedAt),
                      eq(expenseReport.createdAt, pagination.cursor.createdAt),
                      lt(expenseReport.id, pagination.cursor.id),
                  ),
              );

    const reports = await db
        .select()
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.tenantId, tenantId),
                eq(expenseReport.owner, ownerId),
                cursorCondition,
            ),
        )
        .orderBy(
            desc(expenseReport.updatedAt),
            desc(expenseReport.createdAt),
            desc(expenseReport.id),
        )
        .limit(pagination.limit);

    if (reports.length === 0) {
        return [];
    }

    const sentBackRows = await db
        .select({ expenseReportId: auditEntry.expenseReportId })
        .from(auditEntry)
        .where(
            and(
                eq(auditEntry.tenantId, tenantId),
                inArray(
                    auditEntry.expenseReportId,
                    reports.map((report) => report.id),
                ),
                eq(auditEntry.action, "transition_sent_back"),
            ),
        );
    const sentBackReportIds = new Set(
        sentBackRows.map((row) => row.expenseReportId),
    );

    return reports.map((report) => ({
        ...report,
        isSentBack:
            report.currentStage === "Drafted" &&
            sentBackReportIds.has(report.id),
    }));
}

/**
 * Reads line items and mileage after proving the report belongs to the employee and tenant.
 */
export async function findEmployeeSubmissionDetail(
    tenantId: string,
    expenseReportId: string,
    ownerId: string,
): Promise<EmployeeSubmissionDetailContent | undefined> {
    const report = await findExpenseReportById(
        tenantId,
        expenseReportId,
        ownerId,
    );
    if (report === undefined) {
        return undefined;
    }

    const [
        savedLineItems,
        mileageEntries,
        latestSendBackRows,
        latestReviewRows,
    ] = await Promise.all([
        db
            .select()
            .from(lineItem)
            .where(
                and(
                    eq(lineItem.tenantId, tenantId),
                    eq(lineItem.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(asc(lineItem.expenseDate), asc(lineItem.id)),
        db
            .select()
            .from(mileageEntry)
            .where(
                and(
                    eq(mileageEntry.tenantId, tenantId),
                    eq(mileageEntry.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(asc(mileageEntry.mileageDate), asc(mileageEntry.id)),
        db
            .select({ rejectionReason: auditEntry.outcomeReason })
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, expenseReportId),
                    eq(auditEntry.action, "transition_sent_back"),
                ),
            )
            .orderBy(desc(auditEntry.createdAt), desc(auditEntry.id))
            .limit(1),
        db
            .select({
                sourceType: glCodingResult.sourceType,
                sourceId: glCodingResult.sourceId,
                reviewAction: glCodingResult.lineItemReviewAction,
            })
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.expenseReportId, expenseReportId),
                ),
            )
            .orderBy(desc(glCodingResult.codedAt), desc(glCodingResult.id)),
    ]);
    const latestReviewBySource = new Map<string, string | null>();
    for (const row of latestReviewRows) {
        const sourceKey = `${row.sourceType}:${row.sourceId}`;
        if (!latestReviewBySource.has(sourceKey)) {
            latestReviewBySource.set(sourceKey, row.reviewAction);
        }
    }

    return {
        report,
        rejectionReason:
            report.currentStage === "Drafted"
                ? (latestSendBackRows[0]?.rejectionReason ?? null)
                : null,
        lineItems: savedLineItems.map((item) => ({
            ...item,
            reviewAction: parseReviewAction(
                latestReviewBySource.get(`line_item:${item.id}`),
            ),
        })),
        mileageEntries: mileageEntries.map((entry) => ({
            ...entry,
            reviewAction: parseReviewAction(
                latestReviewBySource.get(`mileage:${entry.id}`),
            ),
        })),
    };
}

function parseReviewAction(
    value: string | null | undefined,
): "approve" | "reject" | null {
    return value === "approve" || value === "reject" ? value : null;
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

async function lockOwnedDraft(
    transaction: ExpenseReportTransaction,
    request: {
        tenantId: string;
        expenseReportId: string;
        ownerId: string;
    },
): Promise<
    | { kind: "draft" }
    | { kind: "invalid_stage"; currentStage: ExpenseReportStage }
    | { kind: "not_found" }
> {
    const reports = await transaction
        .select({ currentStage: expenseReport.currentStage })
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

    return { kind: "draft" };
}

async function touchDraftAndAudit(
    transaction: ExpenseReportTransaction,
    request: {
        tenantId: string;
        expenseReportId: string;
        actorId: string;
    },
    action: string,
): Promise<void> {
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
        action,
        stageBeforeAction: "Drafted",
        stageAfterProposedAction: "Drafted",
    });
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
 * Updates one saved line item in an employee-owned Drafted Expense Report.
 */
export async function updateDraftLineItem(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    sourceId: string;
    merchant: string;
    expenseDate: string;
    category: string;
    amount: string;
    currency: string;
}): Promise<ModifyDraftSourceResult> {
    return db.transaction(async (transaction) => {
        const draftCheck = await lockOwnedDraft(transaction, request);
        if (draftCheck.kind !== "draft") {
            return draftCheck;
        }

        const updatedRows = await transaction
            .update(lineItem)
            .set({
                merchant: request.merchant,
                expenseDate: request.expenseDate,
                category: request.category,
                amount: request.amount,
                currency: request.currency,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(lineItem.tenantId, request.tenantId),
                    eq(lineItem.expenseReportId, request.expenseReportId),
                    eq(lineItem.id, request.sourceId),
                ),
            )
            .returning({ id: lineItem.id });
        if (updatedRows.length === 0) {
            return { kind: "not_found" };
        }

        await transaction
            .update(receiptMetadata)
            .set({
                merchant: request.merchant,
                receiptDate: request.expenseDate,
                amount: request.amount,
            })
            .where(
                and(
                    eq(receiptMetadata.tenantId, request.tenantId),
                    eq(
                        receiptMetadata.expenseReportId,
                        request.expenseReportId,
                    ),
                    eq(receiptMetadata.lineItemId, request.sourceId),
                ),
            );
        await touchDraftAndAudit(
            transaction,
            request,
            "draft_line_item_updated",
        );

        return { kind: "modified" };
    });
}

/**
 * Deletes one saved line item and its receipt metadata from an employee-owned draft.
 */
export async function deleteDraftLineItem(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    sourceId: string;
}): Promise<ModifyDraftSourceResult> {
    return db.transaction(async (transaction) => {
        const draftCheck = await lockOwnedDraft(transaction, request);
        if (draftCheck.kind !== "draft") {
            return draftCheck;
        }

        const sourceRows = await transaction
            .select({ id: lineItem.id })
            .from(lineItem)
            .where(
                and(
                    eq(lineItem.tenantId, request.tenantId),
                    eq(lineItem.expenseReportId, request.expenseReportId),
                    eq(lineItem.id, request.sourceId),
                ),
            )
            .limit(1);
        if (sourceRows.length === 0) {
            return { kind: "not_found" };
        }

        await transaction
            .delete(receiptMetadata)
            .where(
                and(
                    eq(receiptMetadata.tenantId, request.tenantId),
                    eq(
                        receiptMetadata.expenseReportId,
                        request.expenseReportId,
                    ),
                    eq(receiptMetadata.lineItemId, request.sourceId),
                ),
            );
        await transaction
            .delete(lineItem)
            .where(
                and(
                    eq(lineItem.tenantId, request.tenantId),
                    eq(lineItem.expenseReportId, request.expenseReportId),
                    eq(lineItem.id, request.sourceId),
                ),
            );
        await touchDraftAndAudit(
            transaction,
            request,
            "draft_line_item_deleted",
        );

        return { kind: "modified" };
    });
}

/**
 * Updates one mileage entry in an employee-owned Drafted Expense Report.
 */
export async function updateDraftMileageEntry(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    sourceId: string;
    route: string;
    distance: string;
    mileageDate: string;
}): Promise<ModifyDraftSourceResult> {
    return db.transaction(async (transaction) => {
        const draftCheck = await lockOwnedDraft(transaction, request);
        if (draftCheck.kind !== "draft") {
            return draftCheck;
        }

        const updatedRows = await transaction
            .update(mileageEntry)
            .set({
                route: request.route,
                distance: request.distance,
                mileageDate: request.mileageDate,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(mileageEntry.tenantId, request.tenantId),
                    eq(mileageEntry.expenseReportId, request.expenseReportId),
                    eq(mileageEntry.id, request.sourceId),
                ),
            )
            .returning({ id: mileageEntry.id });
        if (updatedRows.length === 0) {
            return { kind: "not_found" };
        }

        await touchDraftAndAudit(
            transaction,
            request,
            "draft_mileage_entry_updated",
        );

        return { kind: "modified" };
    });
}

/**
 * Deletes one mileage entry from an employee-owned Drafted Expense Report.
 */
export async function deleteDraftMileageEntry(request: {
    tenantId: string;
    expenseReportId: string;
    ownerId: string;
    actorId: string;
    sourceId: string;
}): Promise<ModifyDraftSourceResult> {
    return db.transaction(async (transaction) => {
        const draftCheck = await lockOwnedDraft(transaction, request);
        if (draftCheck.kind !== "draft") {
            return draftCheck;
        }

        const deletedRows = await transaction
            .delete(mileageEntry)
            .where(
                and(
                    eq(mileageEntry.tenantId, request.tenantId),
                    eq(mileageEntry.expenseReportId, request.expenseReportId),
                    eq(mileageEntry.id, request.sourceId),
                ),
            )
            .returning({ id: mileageEntry.id });
        if (deletedRows.length === 0) {
            return { kind: "not_found" };
        }

        await touchDraftAndAudit(
            transaction,
            request,
            "draft_mileage_entry_deleted",
        );

        return { kind: "modified" };
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
            const insertedLineItem = insertedLineItems[receipt.lineItemIndex];
            if (
                sourceLineItem === undefined ||
                insertedLineItem === undefined
            ) {
                throw new Error("Receipt line item reference is invalid.");
            }

            return {
                tenantId: request.tenantId,
                expenseReportId: request.expenseReportId,
                lineItemId: insertedLineItem.id,
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
            .returning();
        const insertedReport = insertedReports[0];

        if (insertedReport === undefined) {
            throw new Error("Unable to create Drafted Expense Report.");
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
 * Recovers a committed submission when Redis result persistence failed after the database transaction.
 */
export async function findCommittedSubmissionByIdempotencyKey(
    tenantId: string,
    expenseReportId: string,
    idempotencyKey: string,
    requestHash: string,
): Promise<{ correlationId: string; report: ExpenseReport } | undefined> {
    const outboxRows = await db
        .select({ correlationId: stageTransitionOutbox.correlationId })
        .from(stageTransitionOutbox)
        .where(
            and(
                eq(stageTransitionOutbox.tenantId, tenantId),
                eq(stageTransitionOutbox.expenseReportId, expenseReportId),
                eq(stageTransitionOutbox.idempotencyKey, idempotencyKey),
                eq(stageTransitionOutbox.requestHash, requestHash),
                eq(stageTransitionOutbox.fromStage, "Drafted"),
                eq(stageTransitionOutbox.toStage, "Submitted"),
            ),
        )
        .limit(1);
    const outboxRow = outboxRows[0];
    if (outboxRow === undefined) {
        return undefined;
    }

    const report = await findExpenseReportById(tenantId, expenseReportId);
    if (report?.currentStage !== "Submitted") {
        return undefined;
    }

    return { correlationId: outboxRow.correlationId, report };
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
    employerValidation: EmployerEinValidationForSubmission,
    eventContext: StageTransitionEventContext = {
        correlationId: randomUUID(),
        eventId: randomUUID(),
        occurredAt: new Date(),
    },
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
            .set({
                currentStage: "Submitted",
                ...(employerValidation === null
                    ? {}
                    : {
                          employerEin: employerValidation.ein,
                          employerLegalName: employerValidation.legalName,
                          employerEinValidationStatus:
                              employerValidation.result.status,
                          employerEinValidationReason:
                              readEmployerEinValidationReason(
                                  employerValidation.result,
                              ),
                          employerEinServiceReferenceId:
                              readEmployerEinServiceReferenceId(
                                  employerValidation.result,
                              ),
                          employerEinValidatedAt:
                              employerValidation.validatedAt,
                      }),
                updatedAt: new Date(),
            })
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
        if (employerValidation !== null) {
            await appendAuditEntry(transaction, {
                tenantId,
                expenseReportId,
                actorId,
                action: "employer_ein_validated",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Submitted",
                denialReason: null,
                outcomeReason: buildEmployerEinValidationAuditOutcome(
                    employerValidation.result,
                ),
            });
        }

        await writeSuccessfulStageTransitionAndOutbox(transaction, {
            tenantId,
            id: expenseReportId,
            actor: actorId,
            fromStage: "Drafted",
            toStage: "Submitted",
            reason: expenseReportSubmittedReason,
            ...eventContext,
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
            })
            .where(
                and(
                    eq(glCodingResult.tenantId, request.tenantId),
                    eq(glCodingResult.expenseReportId, request.expenseReportId),
                    inArray(glCodingResult.sourceType, [
                        "line_item",
                        "mileage",
                    ]),
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
 * Records a manager review decision for one reviewable source in Manager Approval.
 */
export async function reviewExpenseReportLineItem(request: {
    tenantId: string;
    expenseReportId: string;
    sourceId: string;
    sourceType?: ReviewableExpenseSourceType;
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

        if (request.sourceType === "mileage") {
            const mileageRows =
                await readApprovalQueueMileageEntriesInTransaction(
                    transaction,
                    request.tenantId,
                    request.expenseReportId,
                    latestSubmissionId,
                );
            if (
                mileageRows.find((row) => row.id === request.sourceId) ===
                undefined
            ) {
                return { kind: "not_found" };
            }
        } else {
            const existingLineItem =
                await readApprovalQueueLineItemInTransaction(
                    transaction,
                    request.tenantId,
                    request.expenseReportId,
                    request.sourceId,
                    latestSubmissionId,
                );
            if (existingLineItem === undefined) {
                return { kind: "not_found" };
            }
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
                    eq(
                        glCodingResult.sourceType,
                        request.sourceType ?? "line_item",
                    ),
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
            action: buildReviewAuditAction(
                request.sourceType ?? "line_item",
                request.action,
            ),
            stageBeforeAction: report.currentStage,
            stageAfterProposedAction: report.currentStage,
            outcomeReason: request.reason ?? null,
        });

        const mileageEntries =
            await readApprovalQueueMileageEntriesInTransaction(
                transaction,
                request.tenantId,
                request.expenseReportId,
                latestSubmissionId,
            );
        const receipts = await readApprovalQueueReceiptsInTransaction(
            transaction,
            request.tenantId,
            request.expenseReportId,
        );
        const lineItemRow =
            request.sourceType === "mileage"
                ? ((await readFirstApprovalQueueLineItemInTransaction(
                      transaction,
                      request.tenantId,
                      request.expenseReportId,
                      latestSubmissionId,
                  )) ??
                  toReviewedMileageQueueRow(mileageEntries, request.sourceId))
                : await readApprovalQueueLineItemInTransaction(
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
                mileageEntries,
                receipts,
            ),
        };
    });
}

/**
 * Records a manual AP Review deductibility decision for one reviewable source.
 */
export async function updateExpenseReportSourceDeductibility(request: {
    tenantId: string;
    expenseReportId: string;
    sourceId: string;
    sourceType: ReviewableExpenseSourceType;
    actorId: string;
    deductible: boolean;
}): Promise<UpdateExpenseReportSourceDeductibilityResult> {
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

        if (report.currentStage !== "AP Review") {
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

        if (request.sourceType === "mileage") {
            const mileageRows =
                await readApprovalQueueMileageEntriesInTransaction(
                    transaction,
                    request.tenantId,
                    request.expenseReportId,
                    latestSubmissionId,
                );
            if (
                mileageRows.find((row) => row.id === request.sourceId) ===
                undefined
            ) {
                return { kind: "not_found" };
            }
        } else {
            const existingLineItem =
                await readApprovalQueueLineItemInTransaction(
                    transaction,
                    request.tenantId,
                    request.expenseReportId,
                    request.sourceId,
                    latestSubmissionId,
                );
            if (existingLineItem === undefined) {
                return { kind: "not_found" };
            }
        }

        const updatedRows = await transaction
            .update(glCodingResult)
            .set({ deductible: request.deductible })
            .where(
                and(
                    eq(glCodingResult.tenantId, request.tenantId),
                    eq(glCodingResult.expenseReportId, request.expenseReportId),
                    eq(glCodingResult.sourceType, request.sourceType),
                    eq(glCodingResult.sourceId, request.sourceId),
                    eq(glCodingResult.submissionId, latestSubmissionId),
                ),
            )
            .returning({ id: glCodingResult.id });

        if (updatedRows.length === 0) {
            return { kind: "not_found" };
        }

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.expenseReportId,
            actorId: request.actorId,
            action: "source_deductibility_updated",
            stageBeforeAction: report.currentStage,
            stageAfterProposedAction: report.currentStage,
            outcomeReason: buildDeductibilityAuditOutcomeReason(request),
        });

        const mileageEntries =
            await readApprovalQueueMileageEntriesInTransaction(
                transaction,
                request.tenantId,
                request.expenseReportId,
                latestSubmissionId,
            );
        const receipts = await readApprovalQueueReceiptsInTransaction(
            transaction,
            request.tenantId,
            request.expenseReportId,
        );
        const lineItemRow =
            request.sourceType === "mileage"
                ? ((await readFirstApprovalQueueLineItemInTransaction(
                      transaction,
                      request.tenantId,
                      request.expenseReportId,
                      latestSubmissionId,
                  )) ??
                  toReviewedMileageQueueRow(mileageEntries, request.sourceId))
                : await readApprovalQueueLineItemInTransaction(
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
            kind: "updated",
            lineItem: toApprovalQueueLineItemResponse(
                lineItemRow,
                openFlagCount,
                unreviewedLineItemCount,
                lineItemRow.sourceType === "mileage" ? [] : mileageEntries,
                receipts,
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

        await writeSuccessfulStageTransitionAndOutbox(transaction, {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: request.fromStage,
            toStage: request.toStage,
            reason: request.reason,
            ...(request.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: request.idempotencyKey }),
            correlationId: request.correlationId ?? randomUUID(),
            eventId: request.eventId ?? randomUUID(),
            occurredAt: request.occurredAt ?? new Date(),
        });

        return true;
    });
}

/**
 * Claims or recovers the durable settlement record before any payment side effect runs.
 */
export async function claimExpenseReportSettlement(request: {
    tenantId: string;
    id: string;
    idempotencyKey: string;
    correlationId: string;
}): Promise<SettlementClaimResult> {
    return db.transaction(async (transaction) => {
        const reports = await transaction
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                ),
            )
            .limit(1)
            .for("update");
        const report = reports[0];

        if (report === undefined) {
            return { kind: "not_found" };
        }

        const existingSettlements = await transaction
            .select()
            .from(expenseReportSettlement)
            .where(
                and(
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                ),
            )
            .limit(1)
            .for("update");
        const existingSettlement = existingSettlements[0];

        if (existingSettlement !== undefined) {
            if (
                existingSettlement.status === "reconciled" &&
                report.currentStage === "Reconciled"
            ) {
                return {
                    kind: "already_reconciled",
                    settlement: existingSettlement,
                    report,
                };
            }

            if (
                existingSettlement.status === "issuing" ||
                existingSettlement.paymentId === null
            ) {
                return {
                    kind: "in_progress",
                    settlement: existingSettlement,
                };
            }

            if (existingSettlement.status === "compensated") {
                return {
                    kind: "terminal_compensated",
                    settlement: existingSettlement,
                };
            }

            return {
                kind: "reuse_payment",
                settlement: existingSettlement,
            };
        }

        if (report.currentStage !== "AP Review") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage as ExpenseReportStage,
            };
        }

        const insertedSettlements = await transaction
            .insert(expenseReportSettlement)
            .values({
                tenantId: request.tenantId,
                expenseReportId: request.id,
                idempotencyKey: request.idempotencyKey,
                correlationId: request.correlationId,
            })
            .returning();
        const settlement = insertedSettlements[0];
        if (settlement === undefined) {
            throw new Error("Unable to claim Expense Report settlement.");
        }

        return { kind: "issue_payment", settlement };
    });
}

/**
 * Persists the payment stub reference for a previously claimed settlement.
 */
export async function recordExpenseReportSettlementPayment(request: {
    tenantId: string;
    id: string;
    actor: string;
    idempotencyKey: string;
    paymentId: string;
}): Promise<SettlementPaymentRecordResult> {
    return db.transaction(async (transaction) => {
        const settlements = await transaction
            .select()
            .from(expenseReportSettlement)
            .where(
                and(
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                    eq(
                        expenseReportSettlement.idempotencyKey,
                        request.idempotencyKey,
                    ),
                ),
            )
            .limit(1)
            .for("update");
        const settlement = settlements[0];
        if (settlement === undefined) {
            return { kind: "not_found" };
        }

        if (settlement.paymentId !== null) {
            return { kind: "already_recorded", settlement };
        }

        const updatedSettlements = await transaction
            .update(expenseReportSettlement)
            .set({
                paymentId: request.paymentId,
                status: "issued",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(expenseReportSettlement.id, settlement.id),
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                ),
            )
            .returning();
        const updatedSettlement = updatedSettlements[0];
        if (updatedSettlement === undefined) {
            return { kind: "not_found" };
        }

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actor,
            action: "payment_stub_issued",
            stageBeforeAction: "AP Review",
            stageAfterProposedAction: "AP Review",
            denialReason: null,
            outcomeReason: "Synthetic payment stub issued for settlement saga.",
        });

        return { kind: "recorded", settlement: updatedSettlement };
    });
}

/**
 * Commits the settlement-owned AP Review to Paid transition for an issued payment.
 */
export async function transitionIssuedExpenseReportSettlementToPaid(request: {
    tenantId: string;
    id: string;
    actor: string;
    settlementId: string;
    paymentId: string;
    reason: string;
    correlationId: string;
    idempotencyKey: string;
    eventId: string;
    occurredAt: Date;
}): Promise<boolean> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.id,
            true,
        );
        const currentStage = report?.currentStage;

        const transitionRequest: TransitionExpenseReportStageRequest = {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: "AP Review",
            toStage: "Paid",
            reason: request.reason,
            correlationId: request.correlationId,
            idempotencyKey: request.idempotencyKey,
            eventId: request.eventId,
            occurredAt: request.occurredAt,
        };

        if (currentStage === undefined) {
            return false;
        }

        if (currentStage !== "AP Review") {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                buildTransitionDenialReason(transitionRequest, currentStage),
            );

            return false;
        }

        const settlements = await transaction
            .select()
            .from(expenseReportSettlement)
            .where(
                and(
                    eq(expenseReportSettlement.id, request.settlementId),
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                    eq(expenseReportSettlement.paymentId, request.paymentId),
                ),
            )
            .limit(1)
            .for("update");
        const settlement = settlements[0];

        if (settlement?.status !== "issued") {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                "Expense Report settlement must be issued before payment-stage transition.",
            );

            return false;
        }

        const transitionedReports = await transaction
            .update(expenseReport)
            .set({
                currentStage: "Paid",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                    eq(expenseReport.currentStage, "AP Review"),
                ),
            )
            .returning({ id: expenseReport.id });

        if (transitionedReports.length === 0) {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                buildTransitionDenialReason(transitionRequest, currentStage),
            );

            return false;
        }

        await writeTransitionAuditEntry(
            transaction,
            transitionRequest,
            currentStage,
            "transition_approved",
        );
        await writeSuccessfulStageTransitionAndOutbox(transaction, {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: "AP Review",
            toStage: "Paid",
            reason: request.reason,
            idempotencyKey: request.idempotencyKey,
            correlationId: request.correlationId,
            eventId: request.eventId,
            occurredAt: request.occurredAt,
        });

        return true;
    });
}

/**
 * Releases an unpaid settlement claim after payment issuance fails before any payment reference exists.
 */
export async function abandonUnpaidExpenseReportSettlementClaim(request: {
    tenantId: string;
    id: string;
    settlementId: string;
}): Promise<AbandonSettlementClaimResult> {
    const abandonedSettlements = await db
        .delete(expenseReportSettlement)
        .where(
            and(
                eq(expenseReportSettlement.id, request.settlementId),
                eq(expenseReportSettlement.tenantId, request.tenantId),
                eq(expenseReportSettlement.expenseReportId, request.id),
                eq(expenseReportSettlement.status, "issuing"),
                isNull(expenseReportSettlement.paymentId),
            ),
        )
        .returning({ id: expenseReportSettlement.id });

    return abandonedSettlements.length === 1
        ? { kind: "abandoned" }
        : { kind: "not_abandoned" };
}

/**
 * Commits the final settlement state with the Paid to Reconciled transition.
 */
export async function reconcileExpenseReportSettlementStage(request: {
    tenantId: string;
    id: string;
    actor: string;
    paymentId: string;
    reason: string;
    correlationId: string;
    idempotencyKey: string;
    eventId: string;
    occurredAt: Date;
}): Promise<boolean> {
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

        const transitionRequest: TransitionExpenseReportStageRequest = {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: "Paid",
            toStage: "Reconciled",
            reason: request.reason,
            correlationId: request.correlationId,
            idempotencyKey: request.idempotencyKey,
            eventId: request.eventId,
            occurredAt: request.occurredAt,
        };

        if (currentStage !== "Paid") {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                buildTransitionDenialReason(transitionRequest, currentStage),
            );

            return false;
        }

        const settlements = await transaction
            .select()
            .from(expenseReportSettlement)
            .where(
                and(
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                    eq(expenseReportSettlement.paymentId, request.paymentId),
                ),
            )
            .limit(1)
            .for("update");
        const settlement = settlements[0];

        if (settlement?.status !== "issued") {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                "Expense Report settlement must be issued before reconciliation.",
            );

            return false;
        }

        const transitionedReports = await transaction
            .update(expenseReport)
            .set({
                currentStage: "Reconciled",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                    eq(expenseReport.currentStage, "Paid"),
                ),
            )
            .returning({ id: expenseReport.id });

        if (transitionedReports.length === 0) {
            await writeDeniedTransitionLog(
                transaction,
                transitionRequest,
                currentStage,
                buildTransitionDenialReason(transitionRequest, currentStage),
            );

            return false;
        }

        const updatedSettlements = await transaction
            .update(expenseReportSettlement)
            .set({ status: "reconciled", updatedAt: new Date() })
            .where(
                and(
                    eq(expenseReportSettlement.id, settlement.id),
                    eq(expenseReportSettlement.tenantId, request.tenantId),
                    eq(expenseReportSettlement.expenseReportId, request.id),
                ),
            )
            .returning({ id: expenseReportSettlement.id });

        if (updatedSettlements.length !== 1) {
            throw new Error("Unable to reconcile Expense Report settlement.");
        }

        await writeTransitionAuditEntry(
            transaction,
            transitionRequest,
            currentStage,
            "transition_approved",
        );
        await writeSuccessfulStageTransitionAndOutbox(transaction, {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: "Paid",
            toStage: "Reconciled",
            reason: request.reason,
            idempotencyKey: request.idempotencyKey,
            correlationId: request.correlationId,
            eventId: request.eventId,
            occurredAt: request.occurredAt,
        });

        return true;
    });
}

/**
 * Marks the durable settlement record compensated after the payment stub is reversed.
 */
export async function markExpenseReportSettlementCompensated(request: {
    tenantId: string;
    id: string;
    settlementId: string;
    paymentId: string;
}): Promise<boolean> {
    const updatedSettlements = await db
        .update(expenseReportSettlement)
        .set({
            paymentId: request.paymentId,
            status: "compensated",
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(expenseReportSettlement.id, request.settlementId),
                eq(expenseReportSettlement.tenantId, request.tenantId),
                eq(expenseReportSettlement.expenseReportId, request.id),
                inArray(expenseReportSettlement.status, ["issuing", "issued"]),
                or(
                    eq(expenseReportSettlement.paymentId, request.paymentId),
                    and(
                        eq(expenseReportSettlement.status, "issuing"),
                        isNull(expenseReportSettlement.paymentId),
                    ),
                ),
            ),
        )
        .returning({ id: expenseReportSettlement.id });

    return updatedSettlements.length === 1;
}

/**
 * Restores a settlement saga from Paid to AP Review after a later saga step fails.
 */
export async function compensatePaidSettlementStage(request: {
    tenantId: string;
    id: string;
    actor: string;
    reason: string;
    correlationId: string;
    eventId: string;
    occurredAt: Date;
}): Promise<SettlementSagaCompensationResult> {
    return db.transaction(async (transaction) => {
        const report = await readCurrentReportForTransition(
            transaction,
            request.tenantId,
            request.id,
            true,
        );

        if (report === undefined) {
            return { kind: "not_found" };
        }

        if (report.currentStage === "AP Review") {
            return { kind: "already_prior_stage" };
        }

        if (report.currentStage !== "Paid") {
            return {
                kind: "invalid_stage",
                currentStage: report.currentStage,
            };
        }

        await transaction
            .update(expenseReport)
            .set({
                currentStage: "AP Review",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(expenseReport.tenantId, request.tenantId),
                    eq(expenseReport.id, request.id),
                    eq(expenseReport.currentStage, "Paid"),
                ),
            );

        await appendAuditEntry(transaction, {
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actor,
            action: "settlement_saga_compensated",
            stageBeforeAction: "Paid",
            stageAfterProposedAction: "AP Review",
            denialReason: null,
            outcomeReason: request.reason,
        });
        await writeSuccessfulStageTransitionAndOutbox(transaction, {
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actor,
            fromStage: "Paid",
            toStage: "AP Review",
            reason: "settlement_saga_compensated",
            correlationId: request.correlationId,
            eventId: request.eventId,
            occurredAt: request.occurredAt,
        });

        return { kind: "compensated", eventId: request.eventId };
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

async function writeSuccessfulStageTransitionAndOutbox(
    transaction: TransactionContext,
    request: TransitionExpenseReportStageRequest & StageTransitionEventContext,
): Promise<void> {
    const transitionId = randomUUID();

    await transaction.insert(stageTransition).values({
        id: transitionId,
        expenseReportId: request.id,
        tenantId: request.tenantId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        actor: request.actor,
        reason: request.reason,
        occurredAt: request.occurredAt,
    });
    await transaction.insert(stageTransitionOutbox).values({
        id: request.eventId,
        stageTransitionId: transitionId,
        expenseReportId: request.id,
        tenantId: request.tenantId,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        requestHash: request.requestHash,
        fromStage: request.fromStage,
        toStage: request.toStage,
        occurredAt: request.occurredAt,
        nextAttemptAt: request.occurredAt,
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
                inArray(glCodingResult.sourceType, ["line_item", "mileage"]),
                eq(glCodingResult.flaggedLineItem, true),
            ),
        );

    return rows.length;
}

function buildDeductibilityAuditOutcomeReason(request: {
    sourceId: string;
    sourceType: ReviewableExpenseSourceType;
    deductible: boolean;
}): string {
    return `manual_deductibility_updated:source_type=${request.sourceType};source_id=${request.sourceId};deductible=${String(request.deductible)}`;
}
function buildReviewAuditAction(
    sourceType: ReviewableExpenseSourceType,
    action: "approve" | "reject",
): string {
    if (sourceType === "mileage") {
        return action === "approve" ? "mileage_approved" : "mileage_rejected";
    }

    return action === "approve" ? "line_item_approved" : "line_item_rejected";
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
                inArray(glCodingResult.sourceType, ["line_item", "mileage"]),
                isNull(glCodingResult.lineItemReviewAction),
            ),
        );

    return rows.length;
}

async function readFirstApprovalQueueLineItemInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
    submissionId: string,
): Promise<ApprovalQueueLineItemRow | undefined> {
    const rows = await transaction
        .select({
            id: glCodingResult.sourceId,
            sourceType: glCodingResult.sourceType,
            expenseReportId: glCodingResult.expenseReportId,
            employee: expenseReport.owner,
            merchant: lineItem.merchant,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            flagCode: glCodingResult.flagCode,
            flagMessage: glCodingResult.flagMessage,
            reviewAction: glCodingResult.lineItemReviewAction,
            deductible: glCodingResult.deductible,
            submissionId: glCodingResult.submissionId,
            codedAt: glCodingResult.codedAt,
            codingResultId: glCodingResult.id,
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
                eq(glCodingResult.submissionId, submissionId),
            ),
        )
        .orderBy(asc(lineItem.createdAt), asc(lineItem.id))
        .limit(1);

    return rows[0] as ApprovalQueueLineItemRow | undefined;
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
            sourceType: glCodingResult.sourceType,
            expenseReportId: glCodingResult.expenseReportId,
            employee: expenseReport.owner,
            merchant: lineItem.merchant,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            flagCode: glCodingResult.flagCode,
            flagMessage: glCodingResult.flagMessage,
            reviewAction: glCodingResult.lineItemReviewAction,
            deductible: glCodingResult.deductible,
            submissionId: glCodingResult.submissionId,
            codedAt: glCodingResult.codedAt,
            codingResultId: glCodingResult.id,
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

function readEmployerEinValidationReason(
    result: EinValidationResult,
): string | null {
    if (result.status === "valid") {
        return null;
    }

    return result.rejectionReason ?? null;
}

function readEmployerEinServiceReferenceId(
    result: EinValidationResult,
): string | null {
    if ("serviceReferenceId" in result) {
        return result.serviceReferenceId ?? null;
    }

    return null;
}

function buildEmployerEinValidationAuditOutcome(
    result: EinValidationResult,
): string {
    return JSON.stringify({
        status: result.status,
        reason: readEmployerEinValidationReason(result),
        serviceReferenceId: readEmployerEinServiceReferenceId(result),
    });
}

function readLatestSubmissionByReport(
    rows: Array<ApprovalQueueLineItemRow | ApprovalQueueMileageEntryRow>,
): Map<string, string> {
    const latestSubmissionByReport = new Map<string, string>();
    const latestRowsByReport = new Map<
        string,
        ApprovalQueueLineItemRow | ApprovalQueueMileageEntryRow
    >();
    for (const row of rows) {
        const current = latestRowsByReport.get(row.expenseReportId);
        if (
            current === undefined ||
            row.codedAt > current.codedAt ||
            (row.codedAt.getTime() === current.codedAt.getTime() &&
                row.codingResultId > current.codingResultId)
        ) {
            latestRowsByReport.set(row.expenseReportId, row);
        }
    }

    for (const row of latestRowsByReport.values()) {
        latestSubmissionByReport.set(row.expenseReportId, row.submissionId);
    }

    return latestSubmissionByReport;
}

async function findApprovalQueueMileageEntries(
    tenantId: string,
): Promise<ApprovalQueueMileageEntryRow[]> {
    const rows = await db
        .select({
            id: glCodingResult.sourceId,
            sourceType: glCodingResult.sourceType,
            expenseReportId: glCodingResult.expenseReportId,
            employee: expenseReport.owner,
            route: mileageEntry.route,
            distance: mileageEntry.distance,
            mileageDate: mileageEntry.mileageDate,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            flagCode: glCodingResult.flagCode,
            flagMessage: glCodingResult.flagMessage,
            reviewAction: glCodingResult.lineItemReviewAction,
            deductible: glCodingResult.deductible,
            submissionId: glCodingResult.submissionId,
            codedAt: glCodingResult.codedAt,
            codingResultId: glCodingResult.id,
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
                inArray(expenseReport.currentStage, [
                    "Submitted",
                    "Manager Approval",
                    "AP Review",
                ]),
            ),
        )
        .orderBy(asc(mileageEntry.mileageDate), asc(glCodingResult.id));

    return rows as ApprovalQueueMileageEntryRow[];
}

async function findApprovalQueueReceipts(
    tenantId: string,
    reportIds: string[],
): Promise<ApprovalQueueReceiptRow[]> {
    const rows = await db
        .select({
            id: receiptMetadata.id,
            expenseReportId: receiptMetadata.expenseReportId,
            lineItemId: receiptMetadata.lineItemId,
            merchant: receiptMetadata.merchant,
            receiptDate: receiptMetadata.receiptDate,
            amount: receiptMetadata.amount,
            blobReference: receiptMetadata.blobReference,
        })
        .from(receiptMetadata)
        .where(
            and(
                eq(receiptMetadata.tenantId, tenantId),
                inArray(receiptMetadata.expenseReportId, reportIds),
            ),
        )
        .orderBy(asc(receiptMetadata.createdAt), asc(receiptMetadata.id));

    return rows;
}

async function readApprovalQueueMileageEntriesInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
    submissionId: string,
): Promise<ApprovalQueueMileageEntryRow[]> {
    const rows = await transaction
        .select({
            id: glCodingResult.sourceId,
            sourceType: glCodingResult.sourceType,
            expenseReportId: glCodingResult.expenseReportId,
            employee: expenseReport.owner,
            route: mileageEntry.route,
            distance: mileageEntry.distance,
            mileageDate: mileageEntry.mileageDate,
            amount: glCodingResult.amount,
            glCode: glCodingResult.glAccountCode,
            currentStage: expenseReport.currentStage,
            flaggedLineItem: glCodingResult.flaggedLineItem,
            flagCode: glCodingResult.flagCode,
            flagMessage: glCodingResult.flagMessage,
            reviewAction: glCodingResult.lineItemReviewAction,
            deductible: glCodingResult.deductible,
            submissionId: glCodingResult.submissionId,
            codedAt: glCodingResult.codedAt,
            codingResultId: glCodingResult.id,
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
            mileageEntry,
            and(
                eq(mileageEntry.tenantId, glCodingResult.tenantId),
                eq(mileageEntry.id, glCodingResult.sourceId),
            ),
        )
        .where(
            and(
                eq(glCodingResult.tenantId, tenantId),
                eq(glCodingResult.expenseReportId, expenseReportId),
                eq(glCodingResult.sourceType, "mileage"),
                eq(glCodingResult.submissionId, submissionId),
            ),
        )
        .orderBy(asc(mileageEntry.mileageDate), asc(glCodingResult.id));

    return rows as ApprovalQueueMileageEntryRow[];
}

async function readApprovalQueueReceiptsInTransaction(
    transaction: TransactionContext,
    tenantId: string,
    expenseReportId: string,
): Promise<ApprovalQueueReceiptRow[]> {
    const rows = await transaction
        .select({
            id: receiptMetadata.id,
            expenseReportId: receiptMetadata.expenseReportId,
            lineItemId: receiptMetadata.lineItemId,
            merchant: receiptMetadata.merchant,
            receiptDate: receiptMetadata.receiptDate,
            amount: receiptMetadata.amount,
            blobReference: receiptMetadata.blobReference,
        })
        .from(receiptMetadata)
        .where(
            and(
                eq(receiptMetadata.tenantId, tenantId),
                eq(receiptMetadata.expenseReportId, expenseReportId),
            ),
        )
        .orderBy(asc(receiptMetadata.createdAt), asc(receiptMetadata.id));

    return rows;
}

function toLatestApprovalQueueLineItems(
    rows: ApprovalQueueLineItemRow[],
    mileageRows: ApprovalQueueMileageEntryRow[],
    receiptRows: ApprovalQueueReceiptRow[] = [],
): ApprovalQueueLineItemResponse[] {
    const latestSubmissionByReport = readLatestSubmissionByReport([
        ...rows,
        ...mileageRows,
    ]);
    const mileageEntriesByReport = groupApprovalQueueMileageEntries(
        mileageRows.filter(
            (row) =>
                latestSubmissionByReport.get(row.expenseReportId) ===
                row.submissionId,
        ),
    );
    const receiptsByReport = groupApprovalQueueReceipts(receiptRows);

    const openFlagCounts = new Map<string, number>();
    const unreviewedLineItemCounts = new Map<string, number>();
    for (const row of [...rows, ...mileageRows]) {
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

    const latestLineItemRows = rows.filter(
        (row) =>
            latestSubmissionByReport.get(row.expenseReportId) ===
            row.submissionId,
    );
    const reportsWithLineItems = new Set(
        latestLineItemRows.map((row) => row.expenseReportId),
    );
    const mileageOnlyRows = mileageRows.filter(
        (row) =>
            latestSubmissionByReport.get(row.expenseReportId) ===
                row.submissionId &&
            !reportsWithLineItems.has(row.expenseReportId),
    );
    return [
        ...latestLineItemRows.map((row) =>
            toApprovalQueueLineItemResponse(
                row,
                openFlagCounts.get(row.expenseReportId) ?? 0,
                unreviewedLineItemCounts.get(row.expenseReportId) ?? 0,
                mileageEntriesByReport.get(row.expenseReportId) ?? [],
                receiptsByReport.get(row.expenseReportId) ?? [],
            ),
        ),
        ...mileageOnlyRows.map((row) =>
            toApprovalQueueLineItemResponse(
                toMileageOnlyApprovalQueueLineItemRow(row),
                openFlagCounts.get(row.expenseReportId) ?? 0,
                unreviewedLineItemCounts.get(row.expenseReportId) ?? 0,
                [],
                receiptsByReport.get(row.expenseReportId) ?? [],
            ),
        ),
    ].filter(
        (row, index, allRows) =>
            allRows.findIndex(
                (candidate) =>
                    candidate.expenseReportId === row.expenseReportId &&
                    candidate.id === row.id,
            ) === index,
    );
}

function toMileageOnlyApprovalQueueLineItemRow(
    row: ApprovalQueueMileageEntryRow,
): ApprovalQueueLineItemRow {
    return {
        id: row.id,
        sourceType: "mileage",
        expenseReportId: row.expenseReportId,
        employee: row.employee,
        merchant: row.route,
        amount: row.amount,
        glCode: row.glCode,
        mileageDistance: row.distance,
        currentStage: row.currentStage,
        flaggedLineItem: row.flaggedLineItem,
        flagCode: row.flagCode,
        flagMessage: row.flagMessage,
        reviewAction: row.reviewAction,
        deductible: row.deductible,
        submissionId: row.submissionId,
        codedAt: row.codedAt,
        codingResultId: row.codingResultId,
    };
}

function toReviewedMileageQueueRow(
    mileageEntries: ApprovalQueueMileageEntryRow[],
    sourceId: string,
): ApprovalQueueLineItemRow | undefined {
    const mileageRow = mileageEntries.find((row) => row.id === sourceId);
    if (mileageRow === undefined) {
        return undefined;
    }

    return toMileageOnlyApprovalQueueLineItemRow(mileageRow);
}

function toApprovalQueueLineItemResponse(
    row: ApprovalQueueLineItemRow,
    openFlagCount: number,
    unreviewedLineItemCount: number,
    mileageEntries: ApprovalQueueMileageEntryRow[] = [],
    receipts: ApprovalQueueReceiptRow[] = [],
): ApprovalQueueLineItemResponse {
    return {
        id: row.id,
        sourceType: row.sourceType,
        expenseReportId: row.expenseReportId,
        employee: row.employee,
        merchant: row.merchant,
        amount: Number(row.amount ?? 0),
        glCode: row.glCode ?? "Unmapped",
        currentStage: row.currentStage as ExpenseReportStage,
        flaggedLineItem: row.flaggedLineItem,
        policyChecks: toPolicyChecks(row),
        reviewAction: row.reviewAction,
        deductible: row.deductible,
        canAdvance:
            row.currentStage === "Manager Approval" &&
            openFlagCount === 0 &&
            unreviewedLineItemCount === 0,
        reportTotalMileage:
            row.sourceType === "mileage"
                ? Number(row.mileageDistance ?? 0)
                : mileageEntries.reduce(
                      (total, entry) => total + Number(entry.distance),
                      0,
                  ),
        mileageEntries: mileageEntries.map(toApprovalQueueMileageEntryResponse),
        receipts: receipts.map(toApprovalQueueReceiptResponse),
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

function groupApprovalQueueReceipts(
    receiptRows: ApprovalQueueReceiptRow[],
): Map<string, ApprovalQueueReceiptRow[]> {
    const receiptsByReport = new Map<string, ApprovalQueueReceiptRow[]>();

    for (const row of receiptRows) {
        receiptsByReport.set(row.expenseReportId, [
            ...(receiptsByReport.get(row.expenseReportId) ?? []),
            row,
        ]);
    }

    return receiptsByReport;
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
        flaggedLineItem: row.flaggedLineItem,
        policyChecks: toPolicyChecks(row),
        reviewAction: row.reviewAction,
        deductible: row.deductible,
    };
}

function toApprovalQueueReceiptResponse(row: ApprovalQueueReceiptRow) {
    return {
        id: row.id,
        lineItemId: row.lineItemId,
        merchant: row.merchant,
        receiptDate: row.receiptDate,
        amount: Number(row.amount),
        filename: readReceiptBlobString(row.blobReference, "filename"),
        contentType: readReceiptBlobString(row.blobReference, "contentType"),
    };
}

function readReceiptBlobString(
    blobReference: unknown,
    key: "contentType" | "filename" | "objectKey",
): string | null {
    if (
        blobReference === null ||
        typeof blobReference !== "object" ||
        !(key in blobReference)
    ) {
        return null;
    }

    const metadata = blobReference as Record<string, unknown>;
    const value = metadata[key];

    return typeof value === "string" ? value : null;
}

function readReceiptBlobNumber(
    blobReference: unknown,
    key: "sizeBytes",
): number | null {
    if (
        blobReference === null ||
        typeof blobReference !== "object" ||
        !(key in blobReference)
    ) {
        return null;
    }

    const metadata = blobReference as Record<string, unknown>;
    const value = metadata[key];

    return typeof value === "number" ? value : null;
}

function toPolicyChecks(
    row: Pick<
        ApprovalQueueLineItemRow | ApprovalQueueMileageEntryRow,
        "flagCode" | "flagMessage" | "flaggedLineItem"
    >,
): ApprovalQueueLineItemResponse["policyChecks"] {
    if (row.flagCode === null || row.flagMessage === null) {
        return [];
    }

    return [
        {
            code: row.flagCode,
            message: row.flagMessage,
            state: row.flaggedLineItem ? "uncleared" : "cleared",
        },
    ];
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
    if (request.fromStage === "AP Review" && request.toStage === "Paid") {
        return false;
    }

    if (request.fromStage === "Paid" && request.toStage === "Reconciled") {
        return false;
    }

    return isExpenseReportWorkflowEdge(request.fromStage, request.toStage);
}

function buildTransitionDenialReason(
    request: TransitionExpenseReportStageRequest,
    currentStage: ExpenseReportStage,
): string {
    if (!isValidTransitionEdge(request)) {
        if (
            (request.fromStage === "AP Review" && request.toStage === "Paid") ||
            (request.fromStage === "Paid" && request.toStage === "Reconciled")
        ) {
            return "Settlement-owned transition must use the settlement route.";
        }

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

/**
 * Reads append-only comments for an Expense Report within a tenant boundary.
 */
export async function findCaseCommentsByExpenseReportId(
    tenantId: string,
    expenseReportId: string,
): Promise<CaseComment[]> {
    return db
        .select()
        .from(caseComment)
        .where(
            and(
                eq(caseComment.tenantId, tenantId),
                eq(caseComment.expenseReportId, expenseReportId),
            ),
        )
        .orderBy(asc(caseComment.createdAt), asc(caseComment.id));
}

/**
 * Appends a comment to an Expense Report within a tenant boundary.
 */
export async function insertCaseCommentForExpenseReport(
    comment: NewCaseComment,
    ownerId?: string,
): Promise<CaseComment | undefined> {
    return db.transaction(async (transaction) => {
        const reportRows = await transaction
            .select({ id: expenseReport.id })
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, comment.tenantId),
                    eq(expenseReport.id, comment.expenseReportId),
                    ...(ownerId === undefined
                        ? []
                        : [eq(expenseReport.owner, ownerId)]),
                ),
            )
            .for("update");
        const report = reportRows[0];

        if (report === undefined) {
            return undefined;
        }

        const inserted = await transaction
            .insert(caseComment)
            .values(comment)
            .returning();
        const created = inserted[0];

        if (created === undefined) {
            throw new Error("Unable to create Expense Report comment.");
        }

        return created;
    });
}
