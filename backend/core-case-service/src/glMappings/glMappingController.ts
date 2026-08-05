import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../db/schema/index.js";
import { ForbiddenError, UnauthorizedError } from "../errors/problem-json.js";
import {
    GlMappingPathParamsSchema,
    UpdateGlMappingInboundRequestSchema,
} from "./glMappingDto.js";
import {
    readGlMappingReference,
    updateGlMapping,
} from "./glMappingRepository.js";

const internalGlMappingRoles = new Set<RoleName>([
    "Finance Admin",
    "Department Manager",
]);

/**
 * Handles internal reads of tenant-scoped GL Mapping reference data.
 */
export async function getGlMappings(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireInternalGlMappingAccess(auth);
        const reference = await readGlMappingReference(auth.tenantId);

        res.status(200).json(reference);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin updates to tenant-scoped GL Mapping reference data.
 */
export async function patchGlMapping(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminGlMappingEditAccess(auth);
        const params = GlMappingPathParamsSchema.parse({ id: req.params.id });
        const body = UpdateGlMappingInboundRequestSchema.parse(req.body);
        const mapping = await updateGlMapping({
            actorId: auth.userId,
            glCodeId: body.glCodeId,
            id: params.id,
            tenantId: auth.tenantId,
        });

        res.status(200).json(mapping);
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

function requireInternalGlMappingAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.some((role) => internalGlMappingRoles.has(role))) {
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
