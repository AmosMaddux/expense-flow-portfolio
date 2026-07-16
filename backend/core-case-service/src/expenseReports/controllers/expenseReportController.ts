import type { NextFunction, Request, Response } from "express";

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
        const report = await createDraftExpenseReport({
            owner: parsedRequest.owner,
            dueDate: parsedRequest.dueDate,
            priority: parsedRequest.priority,
            tenantId: auth.tenantId,
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
        const report = await readExpenseReport({
            ...parsedRequest,
            tenantId: auth.tenantId,
        });

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}

function requireAuthContext(req: Request): NonNullable<Request["auth"]> {
    if (req.auth === undefined) {
        throw new Error(
            "Expense Report route is missing authentication middleware.",
        );
    }

    return req.auth;
}
