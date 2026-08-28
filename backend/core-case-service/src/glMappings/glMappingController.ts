import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../db/schema/index.js";
import { ForbiddenError, UnauthorizedError } from "../errors/problem-json.js";
import { SaveGlMappingsInboundRequestSchema } from "./glMappingDto.js";
import { readGlMappingReference, saveGlMappings } from "./glMappingRepository.js";

const glMappingReadRoles = new Set<RoleName>([
    "Finance Admin",
    "Department Manager",
    "Employee",
]);

/**
 * Handles reads of tenant-scoped GL Mapping reference data. Internal roles
 * use this for the GL Mapping admin screen; Employees use it to populate
 * the expense category options when submitting an expense report.
 */
export async function getGlMappings(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireGlMappingReadAccess(auth);
        const reference = await readGlMappingReference(auth.tenantId);

        res.status(200).json(reference);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin batch saves (create, edit, delete) of tenant-scoped
 * GL Mapping reference data. The save is applied atomically: either every
 * requested change is persisted, or none are.
 */
export async function putGlMappings(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminGlMappingEditAccess(auth);
        const body = SaveGlMappingsInboundRequestSchema.parse(req.body);
        const reference = await saveGlMappings({
            actorId: auth.userId,
            tenantId: auth.tenantId,
            ...body,
        });

        res.status(200).json(reference);
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

function requireGlMappingReadAccess(auth: NonNullable<Request["auth"]>): void {
    if (auth.roles.some((role) => glMappingReadRoles.has(role))) {
        return;
    }

    throw new ForbiddenError("GL Mapping access is limited to internal roles.");
}

function requireFinanceAdminGlMappingEditAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Finance Admin")) {
        return;
    }

    throw new ForbiddenError("GL Mapping edits are limited to Finance Admins.");
}
