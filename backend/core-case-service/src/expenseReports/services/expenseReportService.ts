import { randomUUID } from "node:crypto";

import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import { loadDefaultGlCodingConfig } from "../../config/glCodingConfig.js";
import { loadMileageConfig } from "../../config/mileageConfig.js";
import {
    BadGatewayError,
    ConflictError,
    ConfigurationError,
    ForbiddenError,
    NotFoundError,
} from "../../errors/problem-json.js";
import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import type { RoleName } from "../../db/schema/index.js";
import { codeExpenseLineItems } from "../../glCoding/glCodingClient.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";
import {
    createEinValidationAcl,
    type EinValidationAcl,
    type EinValidationResult,
} from "../../tinEin/tinEinValidationAcl.js";
import { TinEinValidationServiceError } from "../../tinEin/tinEinValidationErrors.js";
import {
    buildSubmissionSourceKeys,
    buildSubmissionSourceFingerprint,
    clearExpenseReportFlags as clearExpenseReportFlagsInStore,
    deleteDraftLineItem as deleteDraftLineItemInStore,
    deleteDraftMileageEntry as deleteDraftMileageEntryInStore,
    findApprovalQueueLineItems,
    findAuditEntriesByExpenseReportId,
    findCaseCommentsByExpenseReportId,
    findCommittedSubmissionByIdempotencyKey,
    findCurrentDraftExpenseReport,
    findDraftExpenseContent,
    findExpenseReportById,
    findExpenseReportReviewDetail,
    findReceiptFileMetadata,
    findExpenseReportSummaries,
    abandonUnpaidExpenseReportSettlementClaim,
    claimExpenseReportSettlement,
    compensatePaidSettlementStage,
    markExpenseReportSettlementCompensated,
    insertDraftExpenseReport,
    insertDraftExpenseContent,
    insertCaseCommentForExpenseReport,
    insertMileageEntry,
    insertDeniedFlagClearAuditEntry,
    insertDeniedSubmissionAuditEntry,
    insertDeniedWorkflowTransitionAttempt,
    recordExpenseReportSettlementPayment,
    readDraftSubmissionSources,
    reconcileExpenseReportSettlementStage,
    reviewExpenseReportLineItem as reviewExpenseReportLineItemInStore,
    submitDraftExpenseReport,
    transitionIssuedExpenseReportSettlementToPaid,
    transitionExpenseReportStage as transitionExpenseReportStageInStore,
    updateExpenseReportSourceDeductibility as updateExpenseReportSourceDeductibilityInStore,
    updateDraftLineItem as updateDraftLineItemInStore,
    updateDraftMileageEntry as updateDraftMileageEntryInStore,
} from "../repository/expenseReportRepository.js";
import { invalidateCachedCaseQueueStageRollups } from "./caseQueueService.js";
import {
    AddDraftExpenseContentOutboundResponseSchema,
    AuditEntryOutboundResponseSchema,
    CaseCommentOutboundResponseSchema,
    DraftExpenseContentOutboundResponseSchema,
    ExpenseReportReviewDetailSchema,
    ExpenseReportSummaryPageSchema,
    MileageConfigOutboundResponseSchema,
    MileageEntryOutboundResponseSchema,
    ReceiptUploadOutboundResponseSchema,
    type AddDraftExpenseContentRequest,
    type AddDraftExpenseContentResponse,
    type AuditEntryResponse,
    type CaseCommentResponse,
    type ApprovalQueueLineItemResponse,
    type ClearExpenseReportFlagsRequest,
    type CreateExpenseReportRequest,
    type CreateCaseCommentRequest,
    type CreateMileageEntryRequest,
    type DraftExpenseContentResponse,
    type ExpenseReportResponse,
    type ExpenseReportReviewDetail,
    type ExpenseReportSummaryPage,
    type GetExpenseReportRequest,
    type MileageConfigResponse,
    type MileageEntryResponse,
    type ReceiptUploadMetadataRequest,
    type ReceiptUploadResponse,
    ReadExpenseReportSummariesInboundRequestSchema,
    type ReadExpenseReportSummariesParams,
    type ReviewExpenseReportLineItemRequest,
    type ReviewExpenseReportSourceParams,
    type SettleExpenseReportRequest,
    type TransitionExpenseReportWorkflowRequest,
    type UpdateExpenseReportSourceDeductibilityRequest,
} from "../../schemas/expense-report.schema.js";
import { getDefaultReceiptStorage } from "../../receipts/receiptStorage.js";
import { calculateMileageReimbursement } from "./mileageReimbursement.js";
import {
    dispatchStageTransitionOutboxEvents,
    type StageTransitionOutboxDispatcher,
} from "../../events/stageTransitionOutboxDispatcher.js";
import {
    syntheticPaymentStubIssuer,
    type PaymentStubIssuer,
} from "./paymentStubIssuer.js";

export type StageTransitionEventDependencies = {
    stageTransitionOutboxDispatcher: StageTransitionOutboxDispatcher;
};

export type SettlementSagaDependencies =
    Partial<StageTransitionEventDependencies> & {
        paymentStubIssuer?: PaymentStubIssuer;
    };

export type ExpenseReportSubmissionDependencies =
    Partial<StageTransitionEventDependencies> & {
        einValidationAcl?: EinValidationAcl;
    };

export type SubmitExpenseReportResult = {
    correlationId: string;
    report: ExpenseReportResponse;
};

export type ReceiptFileResponse = {
    content: NodeJS.ReadableStream;
    contentLength: number | null;
    contentType: string;
    filename: string | null;
};

/**
 * Creates a Drafted Expense Report and returns the public API response shape.
 */
export async function createDraftExpenseReport(
    request: CreateExpenseReportRequest & {
        id?: string;
        tenantId: string;
        actorId: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await insertDraftExpenseReport(
        request.tenantId,
        {
            ...(request.id === undefined ? {} : { id: request.id }),
            tenantId: request.tenantId,
            owner: request.owner,
            dueDate: request.dueDate,
            priority: request.priority,
            currentStage: "Drafted",
        },
        request.actorId,
    );

    if (report === undefined) {
        throw new Error("Unable to create Expense Report.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads an Expense Report by case identifier and returns the public API response shape.
 */
export async function readExpenseReport(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads all sources for a Finance Admin report-detail surface.
 */
export async function readExpenseReportReviewDetail(request: {
    id: string;
    tenantId: string;
    now?: () => Date;
}): Promise<ExpenseReportReviewDetail> {
    const detail = await findExpenseReportReviewDetail(
        request.tenantId,
        request.id,
    );

    if (detail === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const today = (request.now?.() ?? new Date()).toISOString().slice(0, 10);

    return ExpenseReportReviewDetailSchema.parse({
        ...detail,
        isOverdue: detail.status !== "Reconciled" && detail.dueDate < today,
    });
}

/**
 * Reads tenant-scoped Expense Report summaries for internal workspaces.
 */
export async function readExpenseReportSummaries(
    request: {
        tenantId: string;
        roles: RoleName[];
    } & ReadExpenseReportSummariesParams,
): Promise<ExpenseReportSummaryPage> {
    if (!request.roles.includes("Finance Admin")) {
        throw new ForbiddenError();
    }

    const parsedRequest = ReadExpenseReportSummariesInboundRequestSchema.parse({
        amountMax: request.amountMax,
        amountMin: request.amountMin,
        category: request.category,
        cursor: request.cursor,
        date: request.date,
        employee: request.employee,
        limit: request.limit,
        status: request.status,
        tenantId: request.tenantId,
    });

    return ExpenseReportSummaryPageSchema.parse(
        await findExpenseReportSummaries(parsedRequest),
    );
}

/**
 * Reads manager-review line items in the authenticated tenant's Approval Queue.
 */
export async function readApprovalQueueLineItems(request: {
    tenantId: string;
    roles: RoleName[];
}): Promise<ApprovalQueueLineItemResponse[]> {
    if (!canReviewWorkflow(request.roles)) {
        throw new ForbiddenError();
    }

    return findApprovalQueueLineItems(request.tenantId);
}

/**
 * Opens a tenant-scoped receipt stream for an internal review surface.
 */
export async function readReceiptFile(request: {
    expenseReportId: string;
    receiptId: string;
    tenantId: string;
}): Promise<ReceiptFileResponse> {
    const receipt = await findReceiptFileMetadata(
        request.tenantId,
        request.expenseReportId,
        request.receiptId,
    );
    if (receipt === undefined) {
        throw new NotFoundError("Receipt not found.");
    }

    const storedFile = await getDefaultReceiptStorage().read(receipt.objectKey);

    return {
        content: storedFile.content,
        contentLength: storedFile.contentLength ?? receipt.sizeBytes,
        contentType:
            receipt.contentType ??
            storedFile.contentType ??
            "application/octet-stream",
        filename: receipt.filename,
    };
}

/**
 * Reads the employee's most recently updated Drafted Expense Report.
 */
export async function readCurrentDraftExpenseReport(request: {
    tenantId: string;
    ownerId: string;
}): Promise<ExpenseReportResponse> {
    const report = await findCurrentDraftExpenseReport(
        request.tenantId,
        request.ownerId,
    );
    if (report === undefined) {
        throw new NotFoundError("No Drafted Expense Report was found.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads saved line items, receipts, and mileage from an employee-owned draft.
 */
export async function readDraftExpenseContent(request: {
    id: string;
    tenantId: string;
    ownerId: string;
}): Promise<DraftExpenseContentResponse> {
    const content = await findDraftExpenseContent(
        request.tenantId,
        request.id,
        request.ownerId,
    );
    if (content === undefined) {
        throw new NotFoundError("Drafted Expense Report not found.");
    }

    const mileageConfig = loadMileageConfig();

    return DraftExpenseContentOutboundResponseSchema.parse({
        expenseReportId: content.report.id,
        lineItems: content.lineItems.map((item) => ({
            id: item.id,
            merchant: item.merchant,
            expenseDate: item.expenseDate,
            category: item.category,
            amount: Number(item.amount),
            currency: item.currency,
        })),
        receipts: content.receipts.map((receipt) => ({
            id: receipt.id,
            lineItemId: receipt.lineItemId,
            filename: readReceiptFilename(receipt.blobReference),
            merchant: receipt.merchant,
            receiptDate: receipt.receiptDate,
            amount: Number(receipt.amount),
        })),
        mileageEntries: content.mileageEntries.map((entry) => {
            const distance = Number(entry.distance);

            return {
                id: entry.id,
                route: entry.route,
                distance,
                mileageDate: entry.mileageDate,
                reimbursementAmount: calculateMileageReimbursement(
                    entry.distance,
                    mileageConfig.reimbursementRateDecimal,
                ),
            };
        }),
    });
}

/**
 * Updates one saved line item and returns the refreshed employee-owned draft.
 */
export async function updateDraftLineItem(request: {
    id: string;
    sourceId: string;
    tenantId: string;
    ownerId: string;
    actorId: string;
    merchant: string;
    expenseDate: string;
    category: string;
    amount: number;
    currency: "USD";
}): Promise<DraftExpenseContentResponse> {
    const result = await updateDraftLineItemInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        sourceId: request.sourceId,
        merchant: request.merchant,
        expenseDate: request.expenseDate,
        category: request.category,
        amount: request.amount.toFixed(2),
        currency: request.currency,
    });
    assertDraftSourceModified(result);

    return readDraftExpenseContent(request);
}

/**
 * Deletes one saved line item and returns the refreshed employee-owned draft.
 */
export async function deleteDraftLineItem(request: {
    id: string;
    sourceId: string;
    tenantId: string;
    ownerId: string;
    actorId: string;
}): Promise<DraftExpenseContentResponse> {
    const result = await deleteDraftLineItemInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        sourceId: request.sourceId,
    });
    assertDraftSourceModified(result);

    return readDraftExpenseContent(request);
}

/**
 * Updates one saved mileage entry and returns the refreshed employee-owned draft.
 */
export async function updateDraftMileageEntry(request: {
    id: string;
    sourceId: string;
    tenantId: string;
    ownerId: string;
    actorId: string;
    route: string;
    distance: number;
    mileageDate: string;
}): Promise<DraftExpenseContentResponse> {
    const result = await updateDraftMileageEntryInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        sourceId: request.sourceId,
        route: request.route,
        distance: request.distance.toFixed(2),
        mileageDate: request.mileageDate,
    });
    assertDraftSourceModified(result);

    return readDraftExpenseContent(request);
}

/**
 * Deletes one saved mileage entry and returns the refreshed employee-owned draft.
 */
export async function deleteDraftMileageEntry(request: {
    id: string;
    sourceId: string;
    tenantId: string;
    ownerId: string;
    actorId: string;
}): Promise<DraftExpenseContentResponse> {
    const result = await deleteDraftMileageEntryInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        sourceId: request.sourceId,
    });
    assertDraftSourceModified(result);

    return readDraftExpenseContent(request);
}

function assertDraftSourceModified(result: {
    kind: "modified" | "invalid_stage" | "not_found";
    currentStage?: ExpenseReportResponse["currentStage"];
}): asserts result is { kind: "modified" } {
    if (result.kind === "not_found") {
        throw new NotFoundError("Draft expense entry not found.");
    }
    if (result.kind === "invalid_stage") {
        throw new ConflictError(
            `Expense entries can only be changed in Drafted; this report is in ${result.currentStage ?? "another stage"}.`,
        );
    }
}

/**
 * Returns the reimbursement policy data used by the Mileage form.
 */
export function readMileageConfig(): MileageConfigResponse {
    const config = loadMileageConfig();

    return MileageConfigOutboundResponseSchema.parse({
        ratePerMile: config.reimbursementRate,
        currency: "USD",
    });
}

/**
 * Adds a validated mileage entry to an employee-owned Drafted Expense Report.
 */
export async function addMileageEntry(
    request: CreateMileageEntryRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        ownerId: string;
    },
): Promise<MileageEntryResponse> {
    const config = loadMileageConfig();
    const result = await insertMileageEntry({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        ownerId: request.ownerId,
        actorId: request.actorId,
        route: request.route,
        distance: request.distance.toFixed(2),
        mileageDate: request.mileageDate,
    });

    if (result.kind === "not_found") {
        throw new NotFoundError("Drafted Expense Report not found.");
    }
    if (result.kind === "invalid_stage") {
        throw new ConflictError(
            `Mileage can only be added to a Drafted Expense Report; this report is in ${result.currentStage}.`,
        );
    }

    const distance = Number(result.entry.distance);
    const reimbursementAmount = calculateMileageReimbursement(
        result.entry.distance,
        config.reimbursementRateDecimal,
    );

    return MileageEntryOutboundResponseSchema.parse({
        id: result.entry.id,
        expenseReportId: result.entry.expenseReportId,
        route: result.entry.route,
        distance,
        mileageDate: result.entry.mileageDate,
        reimbursement: {
            ratePerMile: config.reimbursementRate,
            amount: reimbursementAmount,
            currency: "USD",
        },
        createdAt: result.entry.createdAt,
        updatedAt: result.entry.updatedAt,
    });
}

/**
 * Adds line items and receipt references to an employee-owned Drafted report.
 */
export async function addDraftExpenseContent(
    request: AddDraftExpenseContentRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        ownerId: string;
    },
): Promise<AddDraftExpenseContentResponse> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );
    if (report === undefined) {
        throw new NotFoundError("Drafted Expense Report not found.");
    }
    if (report.currentStage !== "Drafted") {
        throw new ConflictError(
            `Expense content can only be added to a Drafted Expense Report; this report is in ${report.currentStage}.`,
        );
    }

    const verifiedReceipts = await Promise.all(
        request.receipts.map(async (receipt) => ({
            ...receipt,
            blobReference: await getDefaultReceiptStorage().verify({
                tenantId: request.tenantId,
                expenseReportId: request.id,
                uploadId: receipt.uploadId,
                contentType: receipt.contentType,
                sizeBytes: receipt.sizeBytes,
            }),
        })),
    );
    const result = await insertDraftExpenseContent({
        ...request,
        receipts: verifiedReceipts,
        expenseReportId: request.id,
    });

    if (result.kind === "not_found") {
        throw new NotFoundError("Drafted Expense Report not found.");
    }
    if (result.kind === "invalid_stage") {
        throw new ConflictError(
            `Expense content can only be added to a Drafted Expense Report; this report is in ${result.currentStage}.`,
        );
    }

    return AddDraftExpenseContentOutboundResponseSchema.parse({
        expenseReportId: request.id,
        lineItemIds: result.lineItemIds,
        receiptIds: result.receiptIds,
    });
}

/**
 * Stores a receipt file for an employee-owned Drafted Expense Report.
 */
export async function uploadReceiptFile(
    request: ReceiptUploadMetadataRequest & {
        content: Uint8Array;
        id: string;
        ownerId: string;
        tenantId: string;
        uploadId: string;
    },
): Promise<ReceiptUploadResponse> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );
    if (report === undefined) {
        throw new NotFoundError("Drafted Expense Report not found.");
    }
    if (report.currentStage !== "Drafted") {
        throw new ConflictError(
            "Receipts can only be uploaded to a Drafted Expense Report.",
        );
    }

    await getDefaultReceiptStorage().put(
        {
            tenantId: request.tenantId,
            expenseReportId: request.id,
            uploadId: request.uploadId,
            contentType: request.contentType,
            sizeBytes: request.sizeBytes,
        },
        request.content,
    );

    return ReceiptUploadOutboundResponseSchema.parse({
        uploadId: request.uploadId,
        filename: request.filename,
        contentType: request.contentType,
        sizeBytes: request.sizeBytes,
    });
}

/**
 * Submits a Drafted Expense Report after appending GL-coding results.
 */
export async function submitExpenseReport(
    request: {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
        correlationId: string;
        idempotencyKey: string;
        requestHash: string;
        employerEin?: string;
        employerLegalName?: string;
    },
    dependencies: ExpenseReportSubmissionDependencies = {},
): Promise<SubmitExpenseReportResult> {
    const sources = await readDraftSubmissionSources(
        request.tenantId,
        request.id,
    );
    if (sources === undefined) {
        const committedSubmission =
            await findCommittedSubmissionByIdempotencyKey(
                request.tenantId,
                request.id,
                request.idempotencyKey,
                request.requestHash,
            );
        if (committedSubmission !== undefined) {
            return {
                correlationId: committedSubmission.correlationId,
                report: toExpenseReportResponse(committedSubmission.report),
            };
        }

        const existing = await findExpenseReportById(
            request.tenantId,
            request.id,
        );
        if (existing === undefined) {
            throw new NotFoundError("Expense Report not found.");
        }

        await insertDeniedSubmissionAuditEntry(
            request.tenantId,
            request.id,
            request.actorId,
            "Only Drafted Expense Reports can be submitted.",
        );
        throw new ConflictError(
            "Only Drafted Expense Reports can be submitted.",
        );
    }
    if (sources.lineItems.length + sources.mileageEntries.length === 0) {
        await insertDeniedSubmissionAuditEntry(
            request.tenantId,
            request.id,
            request.actorId,
            "An Expense Report must contain at least one expense or mileage entry.",
        );
        throw new ConflictError(
            "Add at least one expense or mileage entry before submitting.",
        );
    }

    const authConfig = loadAuthJwtConfig();
    const glConfig = loadDefaultGlCodingConfig();
    const { accessToken } = signAccessToken(
        {
            tenantId: request.tenantId,
            userId: request.actorId,
            roles: request.roles,
            servicePermissions: ["expense-report:submit"],
        },
        authConfig,
        new Date(),
    );
    try {
        // The repository re-confirms Drafted under FOR UPDATE before committing; keep outbound calls outside that lock.
        // Holding a DB transaction across SOAP/GL latency would be riskier than allowing a losing concurrent submit to repeat external calls.
        const employerValidation = await validateEmployerForSubmission(
            request.employerEin,
            request.employerLegalName,
            dependencies.einValidationAcl,
        );

        const glResponse = await codeExpenseLineItems(
            glConfig.GL_CODING_SERVICE_BASE_URL,
            {
                line_items: sources.lineItems.map((item) => ({
                    line_item_id: item.id,
                    merchant: item.merchant,
                    amount: item.amount,
                    currency: item.currency,
                    category: item.category as Parameters<
                        typeof codeExpenseLineItems
                    >[1]["line_items"][number]["category"],
                })),
                mileage: sources.mileageEntries.map((entry) => ({
                    mileage_entry_id: entry.id,
                    route: entry.route,
                    distance: entry.distance,
                    mileage_date: entry.mileageDate,
                })),
            },
            {
                accessToken,
                timeoutMs: glConfig.GL_CODING_TIMEOUT_MS,
                maxRetries: glConfig.GL_CODING_MAX_RETRIES,
                baseBackoffMs: glConfig.GL_CODING_BASE_BACKOFF_MS,
                maxBackoffMs: glConfig.GL_CODING_MAX_BACKOFF_MS,
            },
        );
        const outboxEventId = randomUUID();
        const report = await submitDraftExpenseReport(
            request.tenantId,
            request.id,
            request.actorId,
            randomUUID(),
            glResponse,
            buildSubmissionSourceKeys(sources),
            buildSubmissionSourceFingerprint(sources),
            employerValidation,
            {
                correlationId: request.correlationId,
                eventId: outboxEventId,
                idempotencyKey: request.idempotencyKey,
                requestHash: request.requestHash,
                occurredAt: new Date(),
            },
        );
        if (report === undefined) {
            await insertDeniedSubmissionAuditEntry(
                request.tenantId,
                request.id,
                request.actorId,
                "Only Drafted Expense Reports can be submitted.",
            );
            throw new ConflictError(
                "Only Drafted Expense Reports can be submitted.",
            );
        }

        await invalidateCachedCaseQueueStageRollups(request.tenantId);
        await dispatchOutboxEvent(outboxEventId, dependencies);

        return {
            correlationId: request.correlationId,
            report: toExpenseReportResponse(report),
        };
    } catch (error: unknown) {
        if (error instanceof GlCodingServiceError) {
            throw new BadGatewayError(error.message);
        }

        if (error instanceof ConfigurationError) {
            throw error;
        }

        throw error;
    }
}

async function validateEmployerForSubmission(
    employerEin: string | undefined,
    employerLegalName: string | undefined,
    einValidationAcl: ExpenseReportSubmissionDependencies["einValidationAcl"],
): Promise<{
    ein: string;
    legalName: string;
    result: EinValidationResult;
    validatedAt: Date;
} | null> {
    if (employerEin === undefined || employerLegalName === undefined) {
        return null;
    }

    const validationAcl = einValidationAcl ?? createEinValidationAcl();
    let result: EinValidationResult;
    try {
        result = await validationAcl.validateEin({
            ein: employerEin,
            legalName: employerLegalName,
        });
    } catch (error: unknown) {
        if (!(error instanceof TinEinValidationServiceError)) {
            throw error;
        }

        result = {
            status: "unreachable",
            isValid: false,
            rejectionReason: "EIN validation is temporarily unavailable.",
        };
    }

    return {
        ein: employerEin,
        legalName: employerLegalName,
        result,
        validatedAt: new Date(),
    };
}

/**
 * Clears reviewed line-item flags for an Expense Report.
 */
export async function clearExpenseReportFlags(
    request: ClearExpenseReportFlagsRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
    },
): Promise<{ clearedFlagCount: number }> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        await insertDeniedFlagClearAuditEntry({
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actorId,
            outcomeReason:
                "Authenticated role is not permitted to clear line-item flags.",
        });
        throw new ForbiddenError();
    }

    const clearResult = await clearExpenseReportFlagsInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        actorId: request.actorId,
        sourceIds: request.sourceIds,
        reason: request.reason,
    });

    if (clearResult.kind === "not_found") {
        throw new NotFoundError("Expense Report not found.");
    }

    if (clearResult.kind === "invalid_stage") {
        throw new ConflictError(
            `Line-item flags can only be cleared during Manager Approval; Expense Report is in ${clearResult.currentStage}.`,
        );
    }

    return { clearedFlagCount: clearResult.clearedFlagCount };
}

/**
 * Applies a manager approve/reject decision to one Expense Report line item.
 */
export async function reviewExpenseReportLineItem(
    request: ReviewExpenseReportLineItemRequest & {
        id: string;
        sourceId: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
    },
): Promise<ApprovalQueueLineItemResponse> {
    return reviewExpenseReportSource({
        ...request,
        sourceType: "line_item",
    });
}

/**
 * Applies a manager approve/reject decision to one reviewable Expense Report source.
 */
export async function reviewExpenseReportSource(
    request: ReviewExpenseReportLineItemRequest &
        ReviewExpenseReportSourceParams & {
            tenantId: string;
            actorId: string;
            roles: RoleName[];
        },
): Promise<ApprovalQueueLineItemResponse> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        throw new ForbiddenError();
    }

    const result = await reviewExpenseReportLineItemInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        sourceId: request.sourceId,
        sourceType: request.sourceType,
        actorId: request.actorId,
        action: request.action,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
    });

    if (result.kind === "not_found") {
        throw new NotFoundError("Expense Report review source not found.");
    }

    if (result.kind === "invalid_stage") {
        throw new ConflictError(
            `Expense Report sources can only be reviewed during Manager Approval or AP Review; Expense Report is in ${result.currentStage}.`,
        );
    }

    return result.lineItem;
}

/**
 * Applies a manual AP Review deductibility decision to one Expense Report source.
 */
export async function updateExpenseReportSourceDeductibility(
    request: UpdateExpenseReportSourceDeductibilityRequest &
        ReviewExpenseReportSourceParams & {
            tenantId: string;
            actorId: string;
            roles: RoleName[];
        },
): Promise<ApprovalQueueLineItemResponse> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        throw new ForbiddenError();
    }

    const result = await updateExpenseReportSourceDeductibilityInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        sourceId: request.sourceId,
        sourceType: request.sourceType,
        actorId: request.actorId,
        deductible: request.deductible,
    });

    if (result.kind === "not_found") {
        throw new NotFoundError("Expense Report review source not found.");
    }

    if (result.kind === "invalid_stage") {
        throw new ConflictError(
            `Deductibility can only be updated during AP Review; Expense Report is in ${result.currentStage}.`,
        );
    }

    return result.lineItem;
}
/**
 * Applies role, sequence, and flag guards before moving an Expense Report stage.
 */
export async function transitionExpenseReportWorkflow(
    request: TransitionExpenseReportWorkflowRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
        correlationId: string;
    },
    dependencies?: StageTransitionEventDependencies,
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        await insertDeniedWorkflowTransitionAttempt({
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actorId,
            toStage: request.toStage,
            denialReason:
                "Authenticated role is not permitted to transition Expense Reports.",
        });
        throw new ForbiddenError();
    }

    if (
        isSettlementOwnedTransition(
            report.currentStage as ExpenseReportStage,
            request.toStage,
        )
    ) {
        await insertDeniedWorkflowTransitionAttempt({
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actorId,
            toStage: request.toStage,
            denialReason:
                "Settlement-owned transition must use the settlement route.",
        });
        throw new ConflictError(
            "Expense Report settlement transitions must use the settlement route.",
        );
    }

    const outboxEventId = randomUUID();
    const didTransition = await transitionExpenseReportStageInStore({
        tenantId: request.tenantId,
        id: request.id,
        actor: request.actorId,
        fromStage: report.currentStage as ExpenseReportStage,
        toStage: request.toStage,
        reason: request.reason,
        correlationId: request.correlationId,
        eventId: outboxEventId,
        occurredAt: new Date(),
    });

    if (!didTransition) {
        throw new ConflictError(
            `Expense Report cannot transition from ${report.currentStage} to ${request.toStage}.`,
        );
    }

    await invalidateCachedCaseQueueStageRollups(request.tenantId);
    await dispatchOutboxEvent(outboxEventId, dependencies);

    const transitionedReport = await findExpenseReportById(
        request.tenantId,
        request.id,
    );
    if (transitionedReport === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(transitionedReport);
}

/**
 * Issues the MVP payment stub and reconciles the report as one compensating saga.
 */
export async function settleExpenseReportWorkflow(
    request: SettleExpenseReportRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
        correlationId: string;
        idempotencyKey: string;
    },
    dependencies: SettlementSagaDependencies = {},
): Promise<ExpenseReportResponse> {
    if (!canReviewWorkflow(request.roles)) {
        throw new ForbiddenError(
            "Authenticated role is not permitted to settle Expense Reports.",
        );
    }

    const settlementClaim = await claimExpenseReportSettlement({
        tenantId: request.tenantId,
        id: request.id,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.correlationId,
    });

    if (settlementClaim.kind === "not_found") {
        throw new NotFoundError("Expense Report not found.");
    }

    if (settlementClaim.kind === "already_reconciled") {
        return toExpenseReportResponse(settlementClaim.report);
    }

    if (settlementClaim.kind === "in_progress") {
        throw new ConflictError(
            "Expense Report settlement is already in progress.",
        );
    }

    if (settlementClaim.kind === "terminal_compensated") {
        throw new ConflictError(
            "Expense Report settlement was compensated and cannot be reused.",
        );
    }

    if (settlementClaim.kind === "invalid_stage") {
        throw new ConflictError(
            `Expense Report settlement can only start from AP Review; this report is in ${settlementClaim.currentStage}.`,
        );
    }

    const paymentIssuer =
        dependencies.paymentStubIssuer ?? syntheticPaymentStubIssuer;
    let paymentId: string | undefined;
    if (
        settlementClaim.kind === "reuse_payment" &&
        typeof settlementClaim.settlement.paymentId === "string" &&
        settlementClaim.settlement.paymentId.trim() !== ""
    ) {
        paymentId = settlementClaim.settlement.paymentId;
    }
    const sagaReason = request.reason ?? "Settlement saga completed.";

    try {
        if (settlementClaim.kind === "issue_payment") {
            const payment = await paymentIssuer.issue({
                tenantId: request.tenantId,
                expenseReportId: request.id,
                actorId: request.actorId,
                correlationId: request.correlationId,
            });
            const issuedPaymentId: unknown = payment.paymentId;
            if (
                typeof issuedPaymentId !== "string" ||
                issuedPaymentId.trim() === ""
            ) {
                throw new ConflictError(
                    "Expense Report settlement payment reference is not available.",
                );
            }
            paymentId = issuedPaymentId;

            const paymentRecord = await recordExpenseReportSettlementPayment({
                tenantId: request.tenantId,
                id: request.id,
                actor: request.actorId,
                idempotencyKey: request.idempotencyKey,
                paymentId,
            });
            if (paymentRecord.kind === "not_found") {
                throw new ConflictError(
                    "Expense Report settlement payment could not be recorded.",
                );
            }
        }

        if (paymentId === undefined) {
            throw new ConflictError(
                "Expense Report settlement payment reference is not available.",
            );
        }

        await runIssuedSettlementTransition({
            tenantId: request.tenantId,
            id: request.id,
            settlementId: settlementClaim.settlement.id,
            actorId: request.actorId,
            paymentId,
            reason: "payment_stub_issued",
            correlationId: request.correlationId,
            idempotencyKey: request.idempotencyKey,
            dependencies,
        });

        await runFinalSettlementTransition({
            tenantId: request.tenantId,
            id: request.id,
            actorId: request.actorId,
            paymentId,
            reason: sagaReason,
            correlationId: request.correlationId,
            idempotencyKey: request.idempotencyKey,
            dependencies,
        });
    } catch (error: unknown) {
        if (paymentId === undefined) {
            const abandonResult =
                await abandonUnpaidExpenseReportSettlementClaim({
                    tenantId: request.tenantId,
                    id: request.id,
                    settlementId: settlementClaim.settlement.id,
                });
            if (abandonResult.kind !== "abandoned") {
                throw new ConflictError(
                    "Expense Report settlement payment failed and the unpaid claim could not be released.",
                    { cause: error },
                );
            }
            throw error;
        }

        try {
            await compensateSettlementSaga({
                tenantId: request.tenantId,
                id: request.id,
                settlementId: settlementClaim.settlement.id,
                actorId: request.actorId,
                correlationId: request.correlationId,
                paymentId,
                paymentIssuer,
                dependencies,
            });
        } catch (compensationError: unknown) {
            console.error("Settlement saga failed during compensation.", {
                compensationErrorCategory:
                    getSettlementSagaErrorCategory(compensationError),
                errorCategory: getSettlementSagaErrorCategory(error),
                phase: "settlement_compensation",
            });
            throw new ConflictError(
                "Settlement saga failed and compensation could not complete.",
                {
                    cause: new AggregateError([error, compensationError]),
                },
            );
        }
        if (error instanceof ConflictError) {
            throw error;
        }
        throw new ConflictError(
            "Expense Report settlement failed after payment issuance; compensation completed.",
            { cause: error },
        );
    }

    const reconciledReport = await findExpenseReportById(
        request.tenantId,
        request.id,
    );
    if (reconciledReport === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(reconciledReport);
}

async function runFinalSettlementTransition(request: {
    tenantId: string;
    id: string;
    actorId: string;
    paymentId: string;
    reason: string;
    correlationId: string;
    idempotencyKey: string;
    dependencies: SettlementSagaDependencies;
}): Promise<void> {
    const outboxEventId = randomUUID();
    const didTransition = await reconcileExpenseReportSettlementStage({
        tenantId: request.tenantId,
        id: request.id,
        actor: request.actorId,
        paymentId: request.paymentId,
        reason: request.reason,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        eventId: outboxEventId,
        occurredAt: new Date(),
    });

    if (!didTransition) {
        throw new ConflictError(
            "Expense Report cannot transition from Paid to Reconciled.",
        );
    }

    await invalidateCachedCaseQueueStageRollupsBestEffort(request.tenantId);
    await dispatchOutboxEvent(outboxEventId, request.dependencies);
}

async function runIssuedSettlementTransition(request: {
    tenantId: string;
    id: string;
    settlementId: string;
    actorId: string;
    paymentId: string;
    reason: string;
    correlationId: string;
    idempotencyKey: string;
    dependencies: SettlementSagaDependencies;
}): Promise<void> {
    const outboxEventId = randomUUID();
    const didTransition = await transitionIssuedExpenseReportSettlementToPaid({
        tenantId: request.tenantId,
        id: request.id,
        settlementId: request.settlementId,
        actor: request.actorId,
        paymentId: request.paymentId,
        reason: request.reason,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        eventId: outboxEventId,
        occurredAt: new Date(),
    });

    if (!didTransition) {
        throw new ConflictError(
            "Expense Report cannot transition from AP Review to Paid.",
        );
    }

    await invalidateCachedCaseQueueStageRollups(request.tenantId);
    await dispatchOutboxEvent(outboxEventId, request.dependencies);
}

async function compensateSettlementSaga(request: {
    tenantId: string;
    id: string;
    settlementId: string;
    actorId: string;
    correlationId: string;
    paymentId: string;
    paymentIssuer: PaymentStubIssuer;
    dependencies: SettlementSagaDependencies;
}): Promise<void> {
    try {
        await request.paymentIssuer.compensate({
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actorId,
            correlationId: request.correlationId,
            paymentId: request.paymentId,
            reason: "Settlement saga failed before reconciliation completed.",
        });
    } catch (error: unknown) {
        console.error("Settlement payment-stub compensation failed.", {
            errorCategory: getSettlementSagaErrorCategory(error),
            phase: "payment_stub_compensation",
        });
        throw error;
    }
    const compensationEventId = randomUUID();
    const compensationResult = await compensatePaidSettlementStage({
        tenantId: request.tenantId,
        id: request.id,
        actor: request.actorId,
        reason: "Settlement saga failed before reconciliation completed.",
        correlationId: request.correlationId,
        eventId: compensationEventId,
        occurredAt: new Date(),
    });

    if (
        compensationResult.kind !== "compensated" &&
        compensationResult.kind !== "already_prior_stage"
    ) {
        throw new ConflictError(
            "Settlement saga failed and compensation could not restore the prior stage.",
        );
    }

    const didMarkCompensated = await markExpenseReportSettlementCompensated({
        tenantId: request.tenantId,
        id: request.id,
        settlementId: request.settlementId,
        paymentId: request.paymentId,
    });
    if (!didMarkCompensated) {
        throw new ConflictError(
            "Settlement saga failed and compensation could not mark the payment reversed.",
        );
    }
    await dispatchOutboxEvent(compensationEventId, request.dependencies);
    await invalidateCachedCaseQueueStageRollups(request.tenantId);
}

async function dispatchOutboxEvent(
    eventId: string,
    dependencies: Partial<StageTransitionEventDependencies> = {},
): Promise<void> {
    try {
        const dispatcher = dependencies.stageTransitionOutboxDispatcher;
        if (dispatcher === undefined) {
            await dispatchStageTransitionOutboxEvents(eventId);
            return;
        }

        await dispatcher.dispatch(eventId);
    } catch {
        // The durable outbox retry loop handles dispatch failures after the state change commits.
    }
}

async function invalidateCachedCaseQueueStageRollupsBestEffort(
    tenantId: string,
): Promise<void> {
    try {
        await invalidateCachedCaseQueueStageRollups(tenantId);
    } catch {
        // Reconciliation is already durable; cache refresh must not trigger payment compensation.
    }
}

function getSettlementSagaErrorCategory(error: unknown): string {
    if (error instanceof Error && error.name.trim() !== "") {
        return error.name;
    }

    return typeof error;
}

/**
 * Reads the tenant-scoped audit trail entries for an Expense Report case.
 */
export async function readExpenseReportAuditEntries(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<AuditEntryResponse[]> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const auditEntries = await findAuditEntriesByExpenseReportId(
        request.tenantId,
        request.id,
    );

    return auditEntries.map((entry) =>
        AuditEntryOutboundResponseSchema.parse({
            id: entry.id,
            tenantId: entry.tenantId,
            expenseReportId: entry.expenseReportId,
            actorId: entry.actorId,
            action: entry.action,
            stageBeforeAction: entry.stageBeforeAction,
            stageAfterProposedAction: entry.stageAfterProposedAction,
            denialReason: entry.denialReason,
            outcomeReason: entry.outcomeReason,
            createdAt: entry.createdAt,
        }),
    );
}

/**
 * Reads tenant- and case-scoped comments for an Expense Report case.
 */
export async function readExpenseReportComments(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<CaseCommentResponse[]> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const comments = await findCaseCommentsByExpenseReportId(
        request.tenantId,
        request.id,
    );

    return comments.map(toCaseCommentResponse);
}

/**
 * Appends a tenant- and case-scoped comment to an Expense Report case.
 */
export async function createExpenseReportComment(
    request: CreateCaseCommentRequest &
        GetExpenseReportRequest & {
            tenantId: string;
            authorId: string;
            ownerId?: string;
        },
): Promise<CaseCommentResponse> {
    const comment = await insertCaseCommentForExpenseReport(
        {
            id: randomUUID(),
            tenantId: request.tenantId,
            expenseReportId: request.id,
            authorId: request.authorId,
            body: request.body,
        },
        request.ownerId,
    );

    if (comment === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toCaseCommentResponse(comment);
}

type ExpenseReportStage = ExpenseReportResponse["currentStage"];

function canReviewWorkflow(roles: RoleName[]): boolean {
    return roles.some(
        (role) => role === "Department Manager" || role === "Finance Admin",
    );
}

function isSettlementOwnedTransition(
    fromStage: ExpenseReportStage,
    toStage: ExpenseReportStage,
): boolean {
    return (
        (fromStage === "AP Review" && toStage === "Paid") ||
        (fromStage === "Paid" && toStage === "Reconciled")
    );
}

function toCaseCommentResponse(comment: {
    id: string;
    tenantId: string;
    expenseReportId: string;
    authorId: string;
    body: string;
    createdAt: Date;
}): CaseCommentResponse {
    return CaseCommentOutboundResponseSchema.parse({
        id: comment.id,
        tenantId: comment.tenantId,
        expenseReportId: comment.expenseReportId,
        authorId: comment.authorId,
        body: comment.body,
        createdAt: comment.createdAt,
    });
}

function toExpenseReportResponse(report: {
    id: string;
    tenantId: string;
    owner: string;
    dueDate: string;
    priority: string;
    currentStage: string;
    onHold: boolean;
    holdReason: string | null;
    employerEin?: string | null;
    employerLegalName?: string | null;
    employerEinValidationStatus?: string | null;
    employerEinValidationReason?: string | null;
    employerEinServiceReferenceId?: string | null;
    employerEinValidatedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}): ExpenseReportResponse {
    return {
        id: report.id,
        tenantId: report.tenantId,
        owner: report.owner,
        dueDate: report.dueDate,
        priority: report.priority as ExpenseReportResponse["priority"],
        currentStage:
            report.currentStage as ExpenseReportResponse["currentStage"],
        onHold: report.onHold,
        holdReason: report.holdReason,
        employerEin: report.employerEin ?? null,
        employerLegalName: report.employerLegalName ?? null,
        employerEinValidation:
            report.employerEinValidationStatus === null ||
            report.employerEinValidationStatus === undefined ||
            report.employerEinValidatedAt === null ||
            report.employerEinValidatedAt === undefined
                ? null
                : {
                      status: report.employerEinValidationStatus as
                          "valid" | "invalid" | "unreachable",
                      isValid: report.employerEinValidationStatus === "valid",
                      reason: report.employerEinValidationReason ?? null,
                      serviceReferenceId:
                          report.employerEinServiceReferenceId ?? null,
                      validatedAt: report.employerEinValidatedAt,
                  },
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
    };
}

function readReceiptFilename(blobReference: unknown): string | null {
    if (
        blobReference === null ||
        typeof blobReference !== "object" ||
        !("filename" in blobReference)
    ) {
        return null;
    }

    return typeof blobReference.filename === "string"
        ? blobReference.filename
        : null;
}
