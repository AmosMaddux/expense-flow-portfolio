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
        const parsedRequest = CreateExpenseReportInboundRequestSchema.parse(
            req.body,
        );
        const report = await createDraftExpenseReport(parsedRequest);

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
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const report = await readExpenseReport(parsedRequest);

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}
