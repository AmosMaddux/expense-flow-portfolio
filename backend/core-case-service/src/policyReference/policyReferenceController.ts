import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../db/schema/index.js";
import { ForbiddenError, UnauthorizedError } from "../errors/problem-json.js";
import { ReadPolicyReferenceQuerySchema } from "../expenseReports/dto/expenseReportDto.js";

import { readPolicyReference } from "./policyReferenceService.js";

const policyReferenceRoles = new Set<RoleName>([
    "Finance Admin",
    "Department Manager",
]);

/**
 * Handles tenant-scoped read requests for the expense policy reference.
 */
export async function getPolicyReference(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requirePolicyReferenceAccess(auth);
        ReadPolicyReferenceQuerySchema.parse(req.query);

        const policy = await readPolicyReference({
            tenantId: auth.tenantId,
        });

        res.status(200).json(policy);
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

function requirePolicyReferenceAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.some((role) => policyReferenceRoles.has(role))) {
        return;
    }

    throw new ForbiddenError(
        "Policy Reference access is limited to internal roles.",
    );
}
