import { randomUUID, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { RoleName } from "../../db/schema/index.js";
import {
    ConfigurationError,
    ConflictError,
    ForbiddenError,
    UnauthorizedError,
} from "../../errors/problem-json.js";
import {
    AddDraftExpenseContentInboundRequestSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateCaseCommentInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    DraftExpenseSourceParamsSchema,
    GetExpenseReportInboundRequestSchema,
    IdempotentSubmissionHeaderSchema,
    InternalSettlePaymentStubBodySchema,
    InternalSettlePaymentStubHeadersSchema,
    InternalSettlePaymentStubParamsSchema,
    ReadAllTransactionsQuerySchema,
    ReceiptFileParamsSchema,
    ReadExpenseReportSummariesQuerySchema,
    ReceiptUploadMetadataInboundRequestSchema,
    ReceiptUploadParamsSchema,
    ReadCaseQueueStageRollupsQuerySchema,
    ReadFinanceDashboardTrendQuerySchema,
    ReadMySubmissionsQuerySchema,
    ReviewExpenseReportLineItemInboundRequestSchema,
    ReviewExpenseReportLineItemParamsSchema,
    ReviewExpenseReportSourceParamsSchema,
    StageTransitionCorrelationHeaderSchema,
    SubmitExpenseReportInboundRequestSchema,
    SubmitExpenseReportOperationResultSchema,
    TransitionExpenseReportWorkflowInboundRequestSchema,
    UpdateExpenseReportSourceDeductibilityInboundRequestSchema,
    UpdateDraftLineItemInboundRequestSchema,
} from "../../schemas/expense-report.schema.js";
import { getDefaultIdempotencyStore } from "../../idempotency/defaultIdempotencyStore.js";
import {
    createIdempotencyRequestHash,
    runIdempotentSubmission,
} from "../../idempotency/idempotencyService.js";
import { readTenantAllTransactions } from "../services/allTransactionsService.js";
import { readCachedCaseQueueStageRollups } from "../services/caseQueueService.js";
import { readFinanceDashboardTrend } from "../services/financeDashboardService.js";
import {
    readMySubmissionDetail,
    readMySubmissions,
} from "../services/mySubmissionsService.js";
import {
    logExpenseReportAuditError,
    logExpenseReportAuditSuccess,
    logCoreCaseMetric,
} from "../../logging/coreCaseLogger.js";
import {
    addDraftExpenseContent,
    createExpenseReportComment,
    clearExpenseReportFlags,
    addMileageEntry,
    createDraftExpenseReport,
    deleteDraftLineItem,
    deleteDraftMileageEntry,
    readApprovalQueueLineItems,
    readCurrentDraftExpenseReport,
    readDraftExpenseContent,
    readExpenseReport,
    readExpenseReportAuditEntries,
    readExpenseReportComments,
    readExpenseReportReviewDetail,
    readReceiptFile,
    readExpenseReportSummaries,
    readMileageConfig,
    reviewExpenseReportLineItem,
    reviewExpenseReportSource,
    submitExpenseReport,
    settleExpenseReportWorkflow,
    transitionExpenseReportWorkflow,
    updateExpenseReportSourceDeductibility,
    updateDraftLineItem,
    updateDraftMileageEntry,
    uploadReceiptFile,
} from "../services/expenseReportService.js";
import { insertDeniedSubmissionAuditEntry } from "../repository/expenseReportRepository.js";

const createExpenseReportRouteLogName = "POST /v1/expense-reports";
const auditEntriesRouteLogName = "GET /v1/expense-reports/:id/audit-entries";
const transitionExpenseReportRouteLogName =
    "POST /v1/expense-reports/:id/transitions";
const internalPaymentStubSettlementRouteLogName =
    "POST /v1/internal/expense-reports/:id/payment-stub-settlement";

const internalCommandEnvironmentSchema = z.object({
    CORE_CASE_INTERNAL_COMMAND_TOKEN: z.string().min(32),
});

/**
 * Handles reads for the signed-in employee's own submission list.
 */
export async function getMySubmissions(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedQuery = ReadMySubmissionsQuerySchema.parse({
            cursor: req.query.cursor,
            pageSize: req.query.pageSize,
        });
        const submissions = await readMySubmissions({
            tenantId: auth.tenantId,
            ownerId: auth.userId,
            ...parsedQuery,
        });

        res.status(200).json(submissions);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles detail reads for one signed-in employee submission.
 */
export async function getMySubmissionDetail(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const detail = await readMySubmissionDetail({
            id: parsedParams.id,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
        });

        res.status(200).json(detail);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles reads for the employee's current Drafted Expense Report.
 */
export async function getCurrentDraftExpenseReport(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const report = await readCurrentDraftExpenseReport({
            tenantId: auth.tenantId,
            ownerId: auth.userId,
        });

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles reads for saved content in an employee-owned draft.
 */
export async function getDraftExpenseContent(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const content = await readDraftExpenseContent({
            id: parsedParams.id,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
        });

        res.status(200).json(content);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles updates to one saved line item in an employee-owned draft.
 */
export async function patchDraftLineItem(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = DraftExpenseSourceParamsSchema.parse({
            id: req.params.id,
            sourceId: req.params.sourceId,
        });
        const parsedRequest = UpdateDraftLineItemInboundRequestSchema.parse(
            req.body,
        );
        const content = await updateDraftLineItem({
            ...parsedParams,
            ...parsedRequest,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
            actorId: auth.userId,
        });

        res.status(200).json(content);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles deletion of one saved line item in an employee-owned draft.
 */
export async function deleteDraftLineItemEntry(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = DraftExpenseSourceParamsSchema.parse({
            id: req.params.id,
            sourceId: req.params.sourceId,
        });
        const content = await deleteDraftLineItem({
            ...parsedParams,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
            actorId: auth.userId,
        });

        res.status(200).json(content);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles updates to one saved mileage entry in an employee-owned draft.
 */
export async function patchDraftMileageEntry(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = DraftExpenseSourceParamsSchema.parse({
            id: req.params.id,
            sourceId: req.params.sourceId,
        });
        const parsedRequest = CreateMileageEntryInboundRequestSchema.parse(
            req.body,
        );
        const content = await updateDraftMileageEntry({
            ...parsedParams,
            ...parsedRequest,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
            actorId: auth.userId,
        });

        res.status(200).json(content);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles deletion of one saved mileage entry in an employee-owned draft.
 */
export async function deleteDraftMileageEntryRecord(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = DraftExpenseSourceParamsSchema.parse({
            id: req.params.id,
            sourceId: req.params.sourceId,
        });
        const content = await deleteDraftMileageEntry({
            ...parsedParams,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
            actorId: auth.userId,
        });

        res.status(200).json(content);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles reads for the configured mileage reimbursement policy.
 */
export function getMileageConfig(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        res.status(200).json(readMileageConfig());
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles mileage additions to an employee-owned Drafted Expense Report.
 */
export async function postMileageEntry(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest = CreateMileageEntryInboundRequestSchema.parse(
            req.body,
        );
        const idempotencyKey = parseIdempotencyKey(req);
        const requestHash = createIdempotencyRequestHash({
            id: parsedParams.id,
            ...parsedRequest,
        });
        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: async () =>
                addMileageEntry({
                    ...parsedRequest,
                    id: parsedParams.id,
                    tenantId: auth.tenantId,
                    actorId: auth.userId,
                    ownerId: auth.userId,
                }),
            requestHash,
            store: getDefaultIdempotencyStore(),
            tenantId: auth.tenantId,
        });

        res.status(result.statusCode).json(result.body);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles receipt-byte uploads for an employee-owned draft.
 */
export async function putReceiptUpload(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = ReceiptUploadParamsSchema.parse({
            id: req.params.id,
            uploadId: req.params.uploadId,
        });
        const requestBody: unknown = req.body;
        const parsedMetadata = ReceiptUploadMetadataInboundRequestSchema.parse({
            filename: req.query.filename,
            contentType: req.get("content-type")?.split(";")[0],
            sizeBytes: Buffer.isBuffer(requestBody) ? requestBody.length : 0,
        });
        if (!Buffer.isBuffer(requestBody)) {
            throw new Error("Receipt upload body was not available.");
        }

        const result = await uploadReceiptFile({
            ...parsedMetadata,
            ...parsedParams,
            content: requestBody,
            tenantId: auth.tenantId,
            ownerId: auth.userId,
        });

        res.status(201).json(result);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles batch additions of line items and receipt references to a draft.
 */
export async function postDraftExpenseContent(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireEmployeeAccess(auth);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest = AddDraftExpenseContentInboundRequestSchema.parse(
            req.body,
        );
        const idempotencyKey = parseIdempotencyKey(req);
        const requestHash = createIdempotencyRequestHash({
            id: parsedParams.id,
            ...parsedRequest,
        });
        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: async () =>
                addDraftExpenseContent({
                    ...parsedRequest,
                    id: parsedParams.id,
                    tenantId: auth.tenantId,
                    actorId: auth.userId,
                    ownerId: auth.userId,
                }),
            requestHash,
            store: getDefaultIdempotencyStore(),
            tenantId: auth.tenantId,
        });

        res.status(result.statusCode).json(result.body);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Expense Report creation requests.
 */
export async function postExpenseReport(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedRequest = CreateExpenseReportInboundRequestSchema.parse(
            req.body,
        );
        const ownerScope = getAuthorizedOwnerScope(auth);
        if (ownerScope !== undefined && parsedRequest.owner !== ownerScope) {
            throw new ForbiddenError(
                "Employees may only create their own Expense Reports.",
            );
        }

        const idempotencyKey = parseIdempotencyKey(req);
        const createReport = async () =>
            createDraftExpenseReport({
                owner: parsedRequest.owner,
                dueDate: parsedRequest.dueDate,
                priority: parsedRequest.priority,
                tenantId: auth.tenantId,
                actorId: auth.userId,
            });
        const requestHash = createIdempotencyRequestHash(parsedRequest);

        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: createReport,
            requestHash,
            store: getDefaultIdempotencyStore(),
            tenantId: auth.tenantId,
        });

        if (!result.replayed) {
            logExpenseReportAuditSuccess({
                action: "report_created",
                actorId: auth.userId,
                expenseReportId: readExpenseReportId(result.body),
                route: createExpenseReportRouteLogName,
                tenantId: auth.tenantId,
            });
        }
        res.status(result.statusCode).json(result.body);
    } catch (error: unknown) {
        logExpenseReportAuditError({
            action: "report_created",
            actorId: req.auth?.userId,
            error,
            route: createExpenseReportRouteLogName,
            tenantId: req.auth?.tenantId,
        });
        next(error);
    }
}

/**
 * Handles Expense Report read requests by case identifier.
 */
export async function getExpenseReportById(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const ownerScope = getAuthorizedOwnerScope(auth);
        const report = await readExpenseReport({
            ...parsedRequest,
            tenantId: auth.tenantId,
            ...(ownerScope === undefined ? {} : { ownerId: ownerScope }),
        });

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles internal Expense Report summary list reads.
 */
export async function getExpenseReports(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminExpenseReportsAccess(auth);
        const parsedQuery = ReadExpenseReportSummariesQuerySchema.parse({
            amountMax: req.query.amountMax,
            amountMin: req.query.amountMin,
            category: req.query.category,
            cursor: req.query.cursor,
            date: req.query.date,
            employee: req.query.employee,
            limit: req.query.limit,
            status: req.query.status,
        });
        const reports = await readExpenseReportSummaries({
            ...parsedQuery,
            tenantId: auth.tenantId,
            roles: auth.roles,
        });

        res.status(200).json(reports);
    } catch (error: unknown) {
        next(error);
    }
}

//OUTBOX submission events
/**
 * Handles Expense Report submission requests.
 */
export async function postExpenseReportSubmission(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });

        // If authenticated user is not finance admin or department manager, they must be the owner of the expense report to submit it
        if (!hasExpenseReportSubmitRole(auth)) {
            await insertDeniedSubmissionAuditEntry(
                auth.tenantId,
                parsedParams.id,
                auth.userId,
                "Authenticated role is not permitted to submit Expense Reports.",
            );
            throw new ForbiddenError();
        }

        const parsedRequest = SubmitExpenseReportInboundRequestSchema.parse(
            req.body,
        );
        const correlationId = parseOrCreateCorrelationId(req);
        annotateRequestTrace(req, correlationId, "submit_expense_report");
        if (
            auth.roles.includes("Employee") &&
            !hasInternalExpenseReportRole(auth)
        ) {
            await readExpenseReport({
                id: parsedParams.id,
                tenantId: auth.tenantId,
                ownerId: auth.userId,
            });
        }
        const idempotencyKey = parseIdempotencyKey(req);
        const requestHash = createIdempotencyRequestHash({
            id: parsedParams.id,
            ...parsedRequest,
        });
        const submitReport = async () =>
            submitExpenseReport({
                id: parsedParams.id,
                tenantId: auth.tenantId,
                actorId: auth.userId,
                roles: auth.roles,
                correlationId,
                ...(req.tracing?.span === undefined
                    ? {}
                    : { traceSpan: req.tracing.span }),
                idempotencyKey,
                requestHash,
                ...(parsedRequest.employerEin === undefined
                    ? {}
                    : { employerEin: parsedRequest.employerEin }),
                ...(parsedRequest.employerLegalName === undefined
                    ? {}
                    : { employerLegalName: parsedRequest.employerLegalName }),
            });
        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: submitReport,
            requestHash,
            store: getDefaultIdempotencyStore(),
            tenantId: auth.tenantId,
        });

        const submission = SubmitExpenseReportOperationResultSchema.parse(
            result.body,
        );
        res.set("X-Correlation-Id", submission.correlationId);
        res.status(result.statusCode).json(submission.report);
    } catch (error: unknown) {
        if (
            error instanceof Error &&
            error.message === "Only Drafted Expense Reports can be submitted."
        ) {
            next(new ConflictError(error.message));
            return;
        }

        next(error);
    }
}

/**
 * Handles guarded Expense Report workflow transition requests.
 */
export async function postExpenseReportTransition(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    let parsedExpenseReportId: string | undefined;

    try {
        const auth = requireAuthContext(req);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        parsedExpenseReportId = parsedParams.id;
        const parsedRequest =
            TransitionExpenseReportWorkflowInboundRequestSchema.parse(req.body);
        const correlationId = parseOrCreateCorrelationId(req);
        annotateRequestTrace(
            req,
            correlationId,
            "transition_expense_report",
        );
        res.set("X-Correlation-Id", correlationId);
        const report = await transitionExpenseReportWorkflow({
            id: parsedParams.id,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            toStage: parsedRequest.toStage,
            reason: parsedRequest.reason,
            correlationId,
        });

        logExpenseReportAuditSuccess({
            action: "workflow_transition_applied",
            actorId: auth.userId,
            expenseReportId: parsedParams.id,
            currentStage: report.currentStage,
            route: transitionExpenseReportRouteLogName,
            tenantId: auth.tenantId,
            toStage: parsedRequest.toStage,
        });
        logCoreCaseMetric({
            environment: "sandbox",
            eventType: "stage_transition",
            metricName: "StageTransitionSuccessCount",
            metricValue: 1,
            outcome: "success",
            route: transitionExpenseReportRouteLogName,
            service: "core-case-service",
            tenantId: auth.tenantId,
            toStage: parsedRequest.toStage,
        });
        res.status(200).json(report);
    } catch (error: unknown) {
        logExpenseReportAuditError({
            action: "workflow_transition_applied",
            actorId: req.auth?.userId,
            error,
            expenseReportId: parsedExpenseReportId,
            route: transitionExpenseReportRouteLogName,
            tenantId: req.auth?.tenantId,
        });
        logCoreCaseMetric({
            environment: "sandbox",
            eventType: "stage_transition",
            metricName: "StageTransitionErrorCount",
            metricValue: 1,
            outcome: "error",
            route: transitionExpenseReportRouteLogName,
            service: "core-case-service",
            tenantId: req.auth?.tenantId ?? "unknown",
        });
        next(error);
    }
}

/**
 * Handles trusted internal Issue Payment stub settlement commands.
 */
export async function postInternalExpenseReportPaymentStubSettlement(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        verifyInternalCommandTrust(req);
        const parsedParams = InternalSettlePaymentStubParamsSchema.parse({
            id: req.params.id,
        });
        const parsedHeaders = InternalSettlePaymentStubHeadersSchema.parse({
            "x-core-case-internal-command-token": req.get(
                "x-core-case-internal-command-token",
            ),
            "idempotency-key": req.get("idempotency-key"),
            "x-correlation-id": req.get("x-correlation-id"),
        });
        annotateRequestTrace(
            req,
            parsedHeaders["x-correlation-id"],
            "internal_payment_stub_settlement",
        );
        const parsedRequest = InternalSettlePaymentStubBodySchema.parse(
            req.body ?? {},
        );

        const settleReport = async () =>
            settleExpenseReportWorkflow({
                id: parsedParams.id,
                tenantId: parsedRequest.tenantId,
                actorId: parsedRequest.actorId,
                roles: parsedRequest.roles,
                reason: parsedRequest.reason,
                correlationId: parsedHeaders["x-correlation-id"],
                idempotencyKey: parsedHeaders["idempotency-key"],
                ...(req.tracing?.span === undefined
                    ? {}
                    : { traceSpan: req.tracing.span }),
            });
        const requestHash = createIdempotencyRequestHash({
            command: "internal_payment_stub_settlement",
            id: parsedParams.id,
            tenantId: parsedRequest.tenantId,
            actorId: parsedRequest.actorId,
            roles: parsedRequest.roles,
            reason: parsedRequest.reason,
        });
        const result = await runIdempotentSubmission({
            conflictMessage:
                "An internal Expense Report payment stub settlement with this idempotency key is already in progress.",
            idempotencyKey: parsedHeaders["idempotency-key"],
            operation: async () => ({
                correlationId: parsedHeaders["x-correlation-id"],
                report: await settleReport(),
            }),
            requestHash,
            store: getDefaultIdempotencyStore(),
            successStatusCode: 200,
            tenantId: parsedRequest.tenantId,
        });
        const settlement = SubmitExpenseReportOperationResultSchema.parse(
            result.body,
        );

        res.set("X-Correlation-Id", settlement.correlationId);
        res.status(result.statusCode).json(settlement.report);
    } catch (error: unknown) {
        logExpenseReportAuditError({
            action: "internal_payment_stub_settlement",
            actorId: undefined,
            error,
            expenseReportId: req.params.id,
            route: internalPaymentStubSettlementRouteLogName,
            tenantId: undefined,
        });
        next(error);
    }
}

/**
 * Handles line-item flag clearing after internal review.
 */
export async function postExpenseReportFlagClear(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest = ClearExpenseReportFlagsInboundRequestSchema.parse(
            req.body,
        );
        const result = await clearExpenseReportFlags({
            id: parsedParams.id,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            sourceIds: parsedRequest.sourceIds,
            reason: parsedRequest.reason,
        });

        res.status(200).json(result);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles manager review decisions for one Expense Report line item.
 */
export async function postExpenseReportLineItemReview(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = ReviewExpenseReportLineItemParamsSchema.parse({
            id: req.params.id,
            sourceId: req.params.sourceId,
        });
        const parsedRequest =
            ReviewExpenseReportLineItemInboundRequestSchema.parse(req.body);
        const lineItem = await reviewExpenseReportLineItem({
            id: parsedParams.id,
            sourceId: parsedParams.sourceId,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            action: parsedRequest.action,
            reason: parsedRequest.reason,
        });

        res.status(200).json(lineItem);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles manager review decisions for one Expense Report source.
 */
export async function postExpenseReportSourceReview(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = ReviewExpenseReportSourceParamsSchema.parse({
            id: req.params.id,
            sourceType: req.params.sourceType,
            sourceId: req.params.sourceId,
        });
        const parsedRequest =
            ReviewExpenseReportLineItemInboundRequestSchema.parse(req.body);
        const lineItem = await reviewExpenseReportSource({
            id: parsedParams.id,
            sourceType: parsedParams.sourceType,
            sourceId: parsedParams.sourceId,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            action: parsedRequest.action,
            reason: parsedRequest.reason,
        });

        res.status(200).json(lineItem);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles manual AP Review deductibility decisions for one Expense Report source.
 */
export async function patchExpenseReportSourceDeductibility(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = ReviewExpenseReportSourceParamsSchema.parse({
            id: req.params.id,
            sourceType: req.params.sourceType,
            sourceId: req.params.sourceId,
        });
        const parsedRequest =
            UpdateExpenseReportSourceDeductibilityInboundRequestSchema.parse(
                req.body,
            );
        const lineItem = await updateExpenseReportSourceDeductibility({
            id: parsedParams.id,
            sourceType: parsedParams.sourceType,
            sourceId: parsedParams.sourceId,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            deductible: parsedRequest.deductible,
        });

        res.status(200).json(lineItem);
    } catch (error: unknown) {
        next(error);
    }
}
/**
 * Handles Approval Queue line-item read requests.
 */
export async function getCaseQueueLineItems(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireInternalCaseQueueAccess(auth);
        const lineItems = await readApprovalQueueLineItems({
            tenantId: auth.tenantId,
            roles: auth.roles,
        });

        res.status(200).json(lineItems);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Case Queue rollup read requests for one tenant.
 */
export async function getCaseQueueStageRollups(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireInternalCaseQueueAccess(auth);
        const parsedQuery = ReadCaseQueueStageRollupsQuerySchema.parse({
            asOfDate: req.query.asOfDate,
        });
        const rollups = await readCachedCaseQueueStageRollups({
            tenantId: auth.tenantId,
            asOfDate: parsedQuery.asOfDate,
        });

        res.status(200).json(rollups);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Dashboard trend read requests for one tenant.
 */
export async function getFinanceDashboardTrend(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceDashboardAccess(auth);
        const parsedQuery = ReadFinanceDashboardTrendQuerySchema.parse({
            fromDate: req.query.fromDate,
            toDate: req.query.toDate,
        });
        const trend = await readFinanceDashboardTrend({
            tenantId: auth.tenantId,
            fromDate: parsedQuery.fromDate,
            toDate: parsedQuery.toDate,
        });

        res.status(200).json(trend);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles All Transactions reads for Finance Admins in one tenant.
 */
export async function getAllTransactions(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminAllTransactionsAccess(auth);
        const parsedQuery = ReadAllTransactionsQuerySchema.parse({
            category: req.query.category,
            status: req.query.status,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            limit: req.query.limit,
            cursor: req.query.cursor,
        });
        const transactions = await readTenantAllTransactions({
            ...parsedQuery,
            tenantId: auth.tenantId,
        });

        res.status(200).json(transactions);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin report-detail reads independent of transaction filters.
 */
export async function getExpenseReportReviewDetail(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireInternalCaseQueueAccess(auth);
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const detail = await readExpenseReportReviewDetail({
            ...parsedRequest,
            tenantId: auth.tenantId,
        });

        res.status(200).json(detail);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin receipt-file reads for report-detail previews.
 */
export async function getExpenseReportReceiptFile(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireInternalCaseQueueAccess(auth);
        const parsedParams = ReceiptFileParamsSchema.parse({
            id: req.params.id,
            receiptId: req.params.receiptId,
        });
        const file = await readReceiptFile({
            expenseReportId: parsedParams.id,
            receiptId: parsedParams.receiptId,
            tenantId: auth.tenantId,
        });

        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
            "Content-Disposition",
            `inline; filename="${sanitizeHeaderFilename(file.filename)}"`,
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (file.contentLength !== null) {
            res.setHeader("Content-Length", String(file.contentLength));
        }
        res.status(200);
        await pipeline(file.content, res);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Audit Trail reads for an Expense Report case.
 */
export async function getExpenseReportAuditEntries(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    let parsedExpenseReportId: string | undefined;

    try {
        const auth = requireAuthContext(req);
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        parsedExpenseReportId = parsedRequest.id;
        requireInternalAuditTrailAccess(auth);
        const auditEntries = await readExpenseReportAuditEntries({
            ...parsedRequest,
            tenantId: auth.tenantId,
        });

        logExpenseReportAuditSuccess({
            action: "audit_entries_read",
            actorId: auth.userId,
            expenseReportId: parsedRequest.id,
            route: auditEntriesRouteLogName,
            tenantId: auth.tenantId,
        });
        res.status(200).json(auditEntries);
    } catch (error: unknown) {
        logExpenseReportAuditError({
            action: "audit_entries_read",
            actorId: req.auth?.userId,
            error,
            expenseReportId: parsedExpenseReportId,
            route: auditEntriesRouteLogName,
            tenantId: req.auth?.tenantId,
        });
        next(error);
    }
}

/**
 * Handles comment thread reads for an Expense Report case.
 */
export async function getExpenseReportComments(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const ownerScope = getAuthorizedOwnerScope(auth);
        const comments = await readExpenseReportComments({
            ...parsedRequest,
            tenantId: auth.tenantId,
            ...(ownerScope === undefined ? {} : { ownerId: ownerScope }),
        });

        res.status(200).json(comments);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles comment creation for an Expense Report case.
 */
export async function postExpenseReportComment(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest = CreateCaseCommentInboundRequestSchema.parse(
            req.body,
        );
        const ownerScope = getAuthorizedOwnerScope(auth);
        const comment = await createExpenseReportComment({
            ...parsedParams,
            ...parsedRequest,
            tenantId: auth.tenantId,
            authorId: auth.userId,
            ...(ownerScope === undefined ? {} : { ownerId: ownerScope }),
        });

        res.status(201).json(comment);
    } catch (error: unknown) {
        next(error);
    }
}

function readExpenseReportId(body: unknown): string | undefined {
    if (body === null || typeof body !== "object" || !("id" in body)) {
        return undefined;
    }

    const id = body.id;

    return typeof id === "string" ? id : undefined;
}

function requireAuthContext(req: Request): NonNullable<Request["auth"]> {
    if (req.auth === undefined) {
        throw new UnauthorizedError();
    }

    return req.auth;
}

function requireFinanceDashboardAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Finance Admin")) {
        return;
    }

    throw new ForbiddenError(
        "Finance Dashboard access is limited to Finance Admins.",
    );
}

function requireInternalAuditTrailAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.some((role) => internalExpenseReportRoles.has(role))) {
        return;
    }

    throw new ForbiddenError(
        "Audit Trail access is limited to internal roles.",
    );
}

function requireInternalCaseQueueAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.some((role) => internalExpenseReportRoles.has(role))) {
        return;
    }

    throw new ForbiddenError("Case Queue access is limited to internal roles.");
}

function requireFinanceAdminAllTransactionsAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Finance Admin")) {
        return;
    }

    throw new ForbiddenError(
        "All Transactions access is limited to Finance Admins.",
    );
}

function requireFinanceAdminExpenseReportsAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Finance Admin")) {
        return;
    }

    throw new ForbiddenError(
        "Expense Reports access is limited to Finance Admins.",
    );
}

const internalExpenseReportRoles = new Set<RoleName>([
    "Finance Admin",
    "Department Manager",
]);

function getAuthorizedOwnerScope(
    auth: NonNullable<Request["auth"]>,
): string | undefined {
    if (auth.roles.some((role) => internalExpenseReportRoles.has(role))) {
        return undefined;
    }

    if (auth.roles.includes("Employee")) {
        // Employee Portal access is limited to records owned by the authenticated user.
        return auth.userId;
    }

    throw new ForbiddenError();
}

function hasInternalExpenseReportRole(
    auth: NonNullable<Request["auth"]>,
): boolean {
    return auth.roles.some((role) => internalExpenseReportRoles.has(role));
}

function hasExpenseReportSubmitRole(
    auth: NonNullable<Request["auth"]>,
): boolean {
    return (
        hasInternalExpenseReportRole(auth) || auth.roles.includes("Employee")
    );
}

function requireEmployeeAccess(auth: NonNullable<Request["auth"]>): void {
    if (!auth.roles.includes("Employee")) {
        throw new ForbiddenError(
            "This action is limited to the Employee Portal.",
        );
    }
}

function sanitizeHeaderFilename(filename: string | null): string {
    const fallback = "receipt";
    if (filename === null) {
        return fallback;
    }

    const sanitized = filename.replace(/["\r\n\\]/gu, "_").trim();

    return sanitized.length === 0 ? fallback : sanitized;
}

function parseIdempotencyKey(req: Request): string {
    return IdempotentSubmissionHeaderSchema.parse({
        idempotencyKey: req.get("idempotency-key"),
    }).idempotencyKey;
}

function parseOrCreateCorrelationId(req: Request): string {
    return (
        StageTransitionCorrelationHeaderSchema.parse({
            correlationId: req.get("x-correlation-id"),
        }).correlationId ?? randomUUID()
    );
}

function annotateRequestTrace(
    req: Request,
    correlationId: string,
    eventType: string,
): void {
    if (req.tracing === undefined) {
        return;
    }

    req.tracing.correlationId = correlationId;
    req.tracing.span.setAttribute("expenseflow.correlation_id", correlationId);
    req.tracing.span.setAttribute("expenseflow.event_type", eventType);
}

function verifyInternalCommandTrust(req: Request): void {
    const configuredToken = loadInternalCommandToken();
    const candidateToken = req.get("x-core-case-internal-command-token");
    if (
        candidateToken === undefined ||
        !secretsMatch(candidateToken, configuredToken)
    ) {
        throw new UnauthorizedError(
            "A valid internal command token is required.",
        );
    }
}

function loadInternalCommandToken(): string {
    const parsedConfig = internalCommandEnvironmentSchema.safeParse(
        process.env,
    );
    if (!parsedConfig.success) {
        throw new ConfigurationError(
            "Core Case internal command token configuration is invalid.",
        );
    }

    return parsedConfig.data.CORE_CASE_INTERNAL_COMMAND_TOKEN;
}

function secretsMatch(candidate: string, expected: string): boolean {
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);

    return (
        candidateBuffer.length === expectedBuffer.length &&
        timingSafeEqual(candidateBuffer, expectedBuffer)
    );
}
