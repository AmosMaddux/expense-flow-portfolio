import { ConflictError, NotFoundError } from "../../errors/problem-json.js";
import {
    findExpenseReportById,
    insertDraftExpenseReport,
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
    request: Omit<CreateExpenseReportRequest, "tenant_id"> & {
        id?: string;
        tenantId: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await insertDraftExpenseReport(request.tenantId, {
        ...(request.id === undefined ? {} : { id: request.id }),
        tenantId: request.tenantId,
        owner: request.owner,
        dueDate: request.dueDate,
        priority: request.priority,
        currentStage: "Drafted",
    });

    if (report === undefined) {
        throw new ConflictError(
            "Idempotency key was reused with a different request payload.",
        );
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads an Expense Report by case identifier and returns the public API response shape.
 */
export async function readExpenseReport(
    request: GetExpenseReportRequest,
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(request.id);

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
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
