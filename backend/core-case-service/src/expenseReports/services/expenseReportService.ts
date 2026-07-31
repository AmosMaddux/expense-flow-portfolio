import { randomUUID } from "node:crypto";

import { ConflictError, NotFoundError } from "../../errors/problem-json.js";
import {
    dispatchStageTransitionOutboxEvents,
    type DispatchStageTransitionOutboxEventsDependencies,
} from "../../events/stageTransitionOutboxDispatcher.js";
import {
    findExpenseReportById,
    insertDraftExpenseReport,
    transitionExpenseReportStage as transitionExpenseReportStageInStore,
} from "../repository/expenseReportRepository.js";
import type {
    approvedWorkflowStages,
    ExpenseReport,
} from "../../db/schema/index.js";
import type {
    CreateExpenseReportRequest,
    ExpenseReportResponse,
    GetExpenseReportRequest,
    TransitionExpenseReportWorkflowRequest,
} from "../../schemas/expense-report.schema.js";

export type TransitionExpenseReportWorkflowDependencies = {
    dispatcher?: typeof dispatchStageTransitionOutboxEvents;
    dispatcherDependencies?: DispatchStageTransitionOutboxEventsDependencies;
};

type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

/**
 * Creates a Drafted Expense Report and returns the public API response shape.
 */
export async function createDraftExpenseReport(
    request: Omit<CreateExpenseReportRequest, "tenant_id"> & {
        tenantId: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await insertDraftExpenseReport(request.tenantId, {
        tenantId: request.tenantId,
        owner: request.owner,
        dueDate: request.dueDate,
        priority: request.priority,
        currentStage: "Drafted",
    });

    if (report === undefined) {
        throw new Error("Unable to create Expense Report.");
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

/**
 * Moves an Expense Report through the workflow and queues the outbound event atomically.
 */
export async function transitionExpenseReportWorkflow(
    request: TransitionExpenseReportWorkflowRequest & { id: string },
    dependencies: TransitionExpenseReportWorkflowDependencies = {},
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(request.id);

    if (report === undefined || report.tenantId !== request.tenantId) {
        throw new NotFoundError("Expense Report not found.");
    }

    const eventId = randomUUID();
    const transitioned = await transitionExpenseReportStageInStore({
        ...request,
        fromStage: report.currentStage as ExpenseReportStage,
        eventId,
        occurredAt: new Date(),
    });

    if (!transitioned) {
        throw new ConflictError(
            "Expense Report cannot transition from its current stage to the requested stage.",
        );
    }

    const dispatcher =
        dependencies.dispatcher ?? dispatchStageTransitionOutboxEvents;

    try {
        await dispatcher(eventId, dependencies.dispatcherDependencies);
    } catch {
        // The outbox row is durable; failed immediate dispatch is retried by the relay.
    }

    const updatedReport = await findExpenseReportById(request.id);

    if (updatedReport === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(updatedReport);
}

function toExpenseReportResponse(report: ExpenseReport): ExpenseReportResponse {
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
