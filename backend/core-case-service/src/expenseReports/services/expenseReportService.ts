import { randomUUID } from "node:crypto";

import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import { loadGlCodingConfig } from "../../config/glCodingConfig.js";
import { NotFoundError } from "../../errors/problem-json.js";
import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import type { RoleName } from "../../db/schema/index.js";
import { codeExpenseLineItems } from "../../glCoding/glCodingClient.js";
import {
    findExpenseReportById,
    insertDraftExpenseReport,
    readDraftSubmissionSources,
    submitDraftExpenseReport,
} from "../repository/expenseReportRepository.js";
import type {
    CreateExpenseReportRequest,
    ExpenseReportResponse,
    GetExpenseReportRequest,
} from "../../schemas/expense-report.schema.js";

/**
 * Creates a Drafted Expense Report and returns the public API response shape.
 */
export async function createDraftExpenseReport(
    request: CreateExpenseReportRequest & {
        tenantId: string;
        actorId: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await insertDraftExpenseReport(
        request.tenantId,
        {
            tenantId: request.tenantId,
            owner: request.owner,
            dueDate: request.dueDate,
            priority: request.priority,
            currentStage: "Drafted",
        },
        request.actorId,
    );

    if (report === undefined) {
        throw new Error("Unable to create Expense Report.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads an Expense Report by case identifier and returns the public API response shape.
 */
export async function readExpenseReport(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Submits a Drafted Expense Report after appending GL-coding results.
 */
export async function submitExpenseReport(request: {
    id: string;
    tenantId: string;
    actorId: string;
    roles: RoleName[];
}): Promise<ExpenseReportResponse> {
    const sources = await readDraftSubmissionSources(
        request.tenantId,
        request.id,
    );
    if (sources === undefined) {
        const existing = await findExpenseReportById(request.tenantId, request.id);
        if (existing === undefined) {
            throw new NotFoundError("Expense Report not found.");
        }

        throw new Error("Only Drafted Expense Reports can be submitted.");
    }

    const authConfig = loadAuthJwtConfig();
    const glConfig = loadGlCodingConfig();
    const { accessToken } = signAccessToken(
        {
            tenantId: request.tenantId,
            userId: request.actorId,
            roles: request.roles,
        },
        authConfig,
        new Date(),
    );
    const glResponse = await codeExpenseLineItems(
        glConfig.GL_CODING_SERVICE_BASE_URL,
        {
            line_items: sources.lineItems.map((item) => ({
                line_item_id: item.id,
                merchant: item.merchant,
                amount: item.amount,
                currency: item.currency,
                category:
                    item.category as Parameters<
                        typeof codeExpenseLineItems
                    >[1]["line_items"][number]["category"],
            })),
            mileage: sources.mileageEntries.map((entry) => ({
                mileage_entry_id: entry.id,
                route: entry.route,
                distance: entry.distance,
                mileage_date: entry.mileageDate,
            })),
        },
        {
            accessToken,
            timeoutMs: glConfig.GL_CODING_TIMEOUT_MS,
            maxRetries: glConfig.GL_CODING_MAX_RETRIES,
            baseBackoffMs: glConfig.GL_CODING_BASE_BACKOFF_MS,
            maxBackoffMs: glConfig.GL_CODING_MAX_BACKOFF_MS,
        },
    );
    const report = await submitDraftExpenseReport(
        request.tenantId,
        request.id,
        request.actorId,
        randomUUID(),
        glResponse,
    );
    if (report === undefined) {
        throw new Error("Only Drafted Expense Reports can be submitted.");
    }

    return toExpenseReportResponse(report);
}

function toExpenseReportResponse(report: {
    id: string;
    tenantId: string;
    owner: string;
    dueDate: string;
    priority: string;
    currentStage: string;
    onHold: boolean;
    holdReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}): ExpenseReportResponse {
    return {
        id: report.id,
        tenantId: report.tenantId,
        owner: report.owner,
        dueDate: report.dueDate,
        priority: report.priority as ExpenseReportResponse["priority"],
        currentStage:
            report.currentStage as ExpenseReportResponse["currentStage"],
        onHold: report.onHold,
        holdReason: report.holdReason,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
    };
}
