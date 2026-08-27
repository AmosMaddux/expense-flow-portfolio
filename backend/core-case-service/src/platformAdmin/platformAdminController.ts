import type { NextFunction, Request, Response } from "express";

import { ForbiddenError, UnauthorizedError } from "../errors/problem-json.js";
import { buildRolePermissionMatrix } from "./screenAccessPolicy.js";
import {
    readAuditLogEvents,
    readTenantSummaries,
} from "./platformAdminRepository.js";

/**
 * Handles Platform Admin reads of the read-only role-to-screen-access matrix.
 */
export function getRolePermissionMatrix(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    try {
        const auth = requireAuthContext(req);
        requirePlatformAdminAccess(auth);

        res.status(200).json(buildRolePermissionMatrix());
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Platform Admin reads of every tenant's user-count summary.
 */
export async function getTenantSummaries(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requirePlatformAdminAccess(auth);
        const tenants = await readTenantSummaries();

        res.status(200).json({ tenants });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Platform Admin reads of recent cross-tenant administrative audit
 * events for the read-only Audit Log screen.
 */
export async function getAuditLogEvents(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requirePlatformAdminAccess(auth);
        const events = await readAuditLogEvents();

        res.status(200).json({ events });
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

function requirePlatformAdminAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Admin")) {
        return;
    }

    throw new ForbiddenError(
        "Platform administration is limited to Platform Admins.",
    );
}
