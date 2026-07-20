import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../../db/schema/index.js";
import {
    ConflictError,
    ForbiddenError,
    UnauthorizedError,
} from "../../errors/problem-json.js";
import {
    CreateExpenseReportInboundRequestSchema,
    GetExpenseReportInboundRequestSchema,
    IdempotentSubmissionHeaderSchema,
    SubmitExpenseReportInboundRequestSchema,
} from "../../schemas/expense-report.schema.js";
import { getDefaultIdempotencyStore } from "../../idempotency/defaultIdempotencyStore.js";
import {
    createIdempotencyRequestHash,
    runIdempotentSubmission,
} from "../../idempotency/idempotencyService.js";
import {
    createDraftExpenseReport,
    readExpenseReport,
    submitExpenseReport,
} from "../services/expenseReportService.js";

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

        const createReport = async () =>
            createDraftExpenseReport({
                owner: parsedRequest.owner,
                dueDate: parsedRequest.dueDate,
                priority: parsedRequest.priority,
                tenantId: auth.tenantId,
                actorId: auth.userId,
            });
        const idempotencyKey = parseIdempotencyKey(req);
        const requestHash = createIdempotencyRequestHash(parsedRequest);
        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: createReport,
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
        requireInternalExpenseReportRole(auth);
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest = SubmitExpenseReportInboundRequestSchema.parse(
            req.body,
        );
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

function requireAuthContext(req: Request): NonNullable<Request["auth"]> {
    if (req.auth === undefined) {
        throw new UnauthorizedError();
    }

    return req.auth;
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

function requireInternalExpenseReportRole(auth: NonNullable<Request["auth"]>) {
    if (auth.roles.some((role) => internalExpenseReportRoles.has(role))) {
        return;
    }

    throw new ForbiddenError();
}

function parseIdempotencyKey(req: Request): string {
    return IdempotentSubmissionHeaderSchema.parse({
        idempotencyKey: req.get("idempotency-key"),
    }).idempotencyKey;
}
