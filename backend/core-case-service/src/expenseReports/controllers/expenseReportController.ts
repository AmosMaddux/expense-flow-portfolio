import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../../db/schema/index.js";
import {
    ForbiddenError,
    UnauthorizedError,
} from "../../errors/problem-json.js";
import {
    CreateExpenseReportInboundRequestSchema,
    GetExpenseReportInboundRequestSchema,
} from "../../schemas/expense-report.schema.js";
import {
    createDraftExpenseReport,
    readExpenseReport,
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

        const report = await createDraftExpenseReport({
            owner: parsedRequest.owner,
            dueDate: parsedRequest.dueDate,
            priority: parsedRequest.priority,
            tenantId: auth.tenantId,
            actorId: auth.userId,
        });

        res.status(201).json(report);
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
