import type { NextFunction, Request, Response } from "express";

import {
    CreateExpenseReportInboundRequestSchema,
    GetExpenseReportInboundRequestSchema,
    TransitionExpenseReportWorkflowInboundRequestSchema,
} from "../../schemas/expense-report.schema.js";
import {
    createDraftExpenseReport,
    readExpenseReport,
    transitionExpenseReportWorkflow,
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
        const report = await createDraftExpenseReport({
            owner: parsedRequest.owner,
            dueDate: parsedRequest.dueDate,
            priority: parsedRequest.priority,
            tenantId: parsedRequest.tenant_id,
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
        const parsedRequest = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const report = await readExpenseReport(parsedRequest);

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}

/**
 * Handles Expense Report workflow transition requests.
 */
export async function postExpenseReportTransition(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const parsedParams = GetExpenseReportInboundRequestSchema.parse({
            id: req.params.id,
        });
        const parsedRequest =
            TransitionExpenseReportWorkflowInboundRequestSchema.parse(req.body);
        const report = await transitionExpenseReportWorkflow({
            id: parsedParams.id,
            tenantId: parsedRequest.tenantId,
            actor: parsedRequest.actor,
            toStage: parsedRequest.toStage,
            reason: parsedRequest.reason,
            correlationId: parsedRequest.correlationId,
        });

        res.status(200).json(report);
    } catch (error: unknown) {
        next(error);
    }
}
