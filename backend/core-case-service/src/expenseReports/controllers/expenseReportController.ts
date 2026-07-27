import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../../db/schema/index.js";
import {
    ConflictError,
    ForbiddenError,
    UnauthorizedError,
} from "../../errors/problem-json.js";
import {
    AddDraftExpenseContentInboundRequestSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    GetExpenseReportInboundRequestSchema,
    IdempotentSubmissionHeaderSchema,
    ReceiptUploadMetadataInboundRequestSchema,
    ReceiptUploadParamsSchema,
    ReadCaseQueueStageRollupsQuerySchema,
    ReadMySubmissionsQuerySchema,
    SubmitExpenseReportInboundRequestSchema,
    TransitionExpenseReportWorkflowInboundRequestSchema,
} from "../../schemas/expense-report.schema.js";
import { getDefaultIdempotencyStore } from "../../idempotency/defaultIdempotencyStore.js";
import {
    createIdempotencyRequestHash,
    runIdempotentSubmission,
} from "../../idempotency/idempotencyService.js";
import { readCachedCaseQueueStageRollups } from "../services/caseQueueService.js";
import {
    readMySubmissionDetail,
    readMySubmissions,
} from "../services/mySubmissionsService.js";
import {
    logExpenseReportAuditError,
    logExpenseReportAuditSuccess,
} from "../../logging/coreCaseLogger.js";
import {
    addDraftExpenseContent,
    clearExpenseReportFlags,
    addMileageEntry,
    createDraftExpenseReport,
    readCurrentDraftExpenseReport,
    readDraftExpenseContent,
    readExpenseReport,
    readExpenseReportAuditEntries,
    readMileageConfig,
    submitExpenseReport,
    transitionExpenseReportWorkflow,
    uploadReceiptFile,
} from "../services/expenseReportService.js";
import { insertDeniedSubmissionAuditEntry } from "../repository/expenseReportRepository.js";

const createExpenseReportRouteLogName = "POST /v1/expense-reports";
const auditEntriesRouteLogName = "GET /v1/expense-reports/:id/audit-entries";

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
        const submitReport = async () =>
            submitExpenseReport({
                id: parsedParams.id,
                tenantId: auth.tenantId,
                actorId: auth.userId,
                roles: auth.roles,
            });
        const idempotencyKey = parseIdempotencyKey(req);
        const requestHash = createIdempotencyRequestHash({
            id: parsedParams.id,
            ...parsedRequest,
        });
        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: submitReport,
            requestHash,
            store: getDefaultIdempotencyStore(),
            tenantId: auth.tenantId,
        });

        res.status(result.statusCode).json(result.body);
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
    try {
        const auth = requireAuthContext(req);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest =
            TransitionExpenseReportWorkflowInboundRequestSchema.parse(req.body);
        const report = await transitionExpenseReportWorkflow({
            id: parsedParams.id,
            tenantId: auth.tenantId,
            actorId: auth.userId,
            roles: auth.roles,
            toStage: parsedRequest.toStage,
            reason: parsedRequest.reason,
        });

        res.status(200).json(report);
    } catch (error: unknown) {
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

function parseIdempotencyKey(req: Request): string {
    return IdempotentSubmissionHeaderSchema.parse({
        idempotencyKey: req.get("idempotency-key"),
    }).idempotencyKey;
}
