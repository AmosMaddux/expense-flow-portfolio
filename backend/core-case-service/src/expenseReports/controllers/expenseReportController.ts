import type { NextFunction, Request, Response } from "express";

import {
    CreateExpenseReportInboundRequestSchema,
    GetExpenseReportInboundRequestSchema,
    IdempotentSubmissionHeaderSchema,
} from "../../schemas/expense-report.schema.js";
import { getDefaultIdempotencyStore } from "../../idempotency/defaultIdempotencyStore.js";
import { runIdempotentSubmission } from "../../idempotency/idempotencyService.js";
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
        const createReport = async () =>
            createDraftExpenseReport({
                owner: parsedRequest.owner,
                dueDate: parsedRequest.dueDate,
                priority: parsedRequest.priority,
                tenantId: parsedRequest.tenant_id,
            });
        const idempotencyKey = parseIdempotencyKey(req);
        if (idempotencyKey === undefined) {
            const report = await createReport();

            res.status(201).json(report);
            return;
        }

        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: createReport,
            store: getDefaultIdempotencyStore(),
            tenantId: parsedRequest.tenant_id,
        });

        res.status(result.statusCode).json(result.body);
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

function parseIdempotencyKey(req: Request): string | undefined {
    const header = req.get("idempotency-key");
    if (header === undefined) {
        return undefined;
    }

    return IdempotentSubmissionHeaderSchema.parse({
        idempotencyKey: header,
    }).idempotencyKey;
}
