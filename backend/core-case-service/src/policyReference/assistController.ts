import type { NextFunction, Request, Response } from "express";

import type { RoleName } from "../db/schema/index.js";
import { ForbiddenError, UnauthorizedError } from "../errors/problem-json.js";
import {
    answerAssistQuestion,
    AssistInboundRequestSchema,
} from "./assistService.js";

const assistRoles = new Set<RoleName>(["Finance Admin", "Department Manager"]);

/** Handles tenant-scoped policy assistance for internal Expense Report review. */
export async function postAssist(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const auth = requireAuthContext(req);
        requireAssistAccess(auth);
        const request = AssistInboundRequestSchema.parse(req.body);
        const answer = await answerAssistQuestion({
            ...request,
            tenantId: auth.tenantId,
        });
        res.status(200).json(answer);
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

function requireAssistAccess(auth: NonNullable<Request["auth"]>): void {
    if (auth.roles.some((role) => assistRoles.has(role))) {
        return;
    }
    throw new ForbiddenError("AI Assist access is limited to internal roles.");
}
