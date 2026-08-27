import type { NextFunction, Request, Response } from "express";

import {
    ConflictError,
    ForbiddenError,
    UnauthorizedError,
} from "../errors/problem-json.js";
import {
    InviteTeamUserInboundRequestSchema,
    TeamUserPathParamsSchema,
    UpdateTeamUserRoleInboundRequestSchema,
    UpdateTeamUserStatusInboundRequestSchema,
} from "./teamUsersDto.js";
import {
    inviteTeamUser,
    readTeamUsers,
    updateTeamUserRole,
    updateTeamUserStatus,
} from "./teamUsersRepository.js";

/**
 * Handles Finance Admin reads of every tenant-scoped team member.
 */
export async function getTeamUsers(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminTeamUserAccess(auth);
        const users = await readTeamUsers(auth.tenantId);

        res.status(200).json({ users });
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin invitations of a new tenant user with an assigned role.
 */
export async function postInviteTeamUser(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminTeamUserAccess(auth);
        const body = InviteTeamUserInboundRequestSchema.parse(req.body);
        const invited = await inviteTeamUser({
            actorId: auth.userId,
            displayName: body.displayName,
            email: body.email,
            role: body.role,
            tenantId: auth.tenantId,
        });

        res.status(201).json(invited);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin role reassignment for one tenant user.
 */
export async function patchTeamUserRole(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminTeamUserAccess(auth);
        const params = TeamUserPathParamsSchema.parse({ id: req.params.id });
        requireNotSelfTargeting(auth, params.id);
        const body = UpdateTeamUserRoleInboundRequestSchema.parse(req.body);
        const updated = await updateTeamUserRole({
            actorId: auth.userId,
            id: params.id,
            role: body.role,
            tenantId: auth.tenantId,
        });

        res.status(200).json(updated);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Finance Admin activation or deactivation of one tenant user.
 */
export async function patchTeamUserStatus(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireFinanceAdminTeamUserAccess(auth);
        const params = TeamUserPathParamsSchema.parse({ id: req.params.id });
        requireNotSelfTargeting(auth, params.id);
        const body = UpdateTeamUserStatusInboundRequestSchema.parse(req.body);
        const updated = await updateTeamUserStatus({
            actorId: auth.userId,
            id: params.id,
            status: body.status,
            tenantId: auth.tenantId,
        });

        res.status(200).json(updated);
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

function requireFinanceAdminTeamUserAccess(
    auth: NonNullable<Request["auth"]>,
): void {
    if (auth.roles.includes("Finance Admin")) {
        return;
    }

    throw new ForbiddenError(
        "Team & Users access is limited to Finance Admins.",
    );
}

/**
 * Blocks a Finance Admin from changing their own role or status through this
 * screen, so a misclick cannot lock a tenant out of its own user management
 * (there is no other user who can reach this screen to undo it).
 */
function requireNotSelfTargeting(
    auth: NonNullable<Request["auth"]>,
    targetId: string,
): void {
    if (auth.userId !== targetId) {
        return;
    }

    throw new ConflictError(
        "Finance Admins cannot change their own role or status here.",
    );
}
