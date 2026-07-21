import type { NextFunction, Request, Response } from "express";

import { BadRequestError } from "../../errors/problem-json.js";
import { getDefaultIdempotencyStore } from "../../idempotency/defaultIdempotencyStore.js";
import {
    createIdempotencyRequestHash,
    createIdempotencyResourceId,
    runIdempotentSubmission,
} from "../../idempotency/idempotencyService.js";
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
        const tenantId = parsedRequest.tenant_id;
        const idempotencyKey = parseIdempotencyKey(req);
        const resourceId = createIdempotencyResourceId(
            tenantId,
            idempotencyKey,
        );
        const requestHash = createIdempotencyRequestHash(parsedRequest);

        const result = await runIdempotentSubmission({
            idempotencyKey,
            operation: () =>
                createDraftExpenseReport({
                    id: resourceId,
                    owner: parsedRequest.owner,
                    dueDate: parsedRequest.dueDate,
                    priority: parsedRequest.priority,
                    tenantId,
                }),
            requestHash,
            reservationMetadata: {
                operation: "create_expense_report",
                resourceId,
                tenantId,
            },
            store: getDefaultIdempotencyStore(),
            tenantId,
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

function parseIdempotencyKey(req: Request): string {
    const idempotencyKey = req.get("idempotency-key")?.trim();

    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
        throw new BadRequestError("Idempotency-Key header is required.");
    }

    return idempotencyKey;
}
