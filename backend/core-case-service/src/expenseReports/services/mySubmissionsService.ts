import type { ExpenseReport } from "../../db/schema/index.js";
import {
    MySubmissionListSchema,
    ReadMySubmissionsInboundRequestSchema,
    type MySubmission,
    type ReadMySubmissionsParams,
} from "../../schemas/expense-report.schema.js";
import { findExpenseReportsByOwner } from "../repository/expenseReportRepository.js";

export type MySubmissionsStore = {
    findByOwner(tenantId: string, ownerId: string): Promise<ExpenseReport[]>;
};

export type MySubmissionsServiceDependencies = {
    now?: () => Date;
    store: MySubmissionsStore;
};

/**
 * Builds the employee portal list from records scoped by authenticated tenant and owner.
 */
export async function readMySubmissions(
    request: ReadMySubmissionsParams,
    dependencies: MySubmissionsServiceDependencies = {
        store: { findByOwner: findExpenseReportsByOwner },
    },
): Promise<MySubmission[]> {
    const parsedRequest = ReadMySubmissionsInboundRequestSchema.parse(request);
    const reports = await dependencies.store.findByOwner(
        parsedRequest.tenantId,
        parsedRequest.ownerId,
    );
    const today = toUtcDate(dependencies.now?.() ?? new Date());

    return MySubmissionListSchema.parse(
        reports.map((report) => ({
            id: report.id,
            dueDate: report.dueDate,
            currentStage: report.currentStage,
            onHold: report.onHold,
            isOverdue:
                report.currentStage !== "Reconciled" && report.dueDate < today,
            createdAt: report.createdAt,
            updatedAt: report.updatedAt,
        })),
    );
}

function toUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}
