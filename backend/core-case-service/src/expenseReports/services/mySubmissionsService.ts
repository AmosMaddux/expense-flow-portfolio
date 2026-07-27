import { loadMileageConfig } from "../../config/mileageConfig.js";
import type { ExpenseReport } from "../../db/schema/index.js";
import { NotFoundError } from "../../errors/problem-json.js";
import {
    MySubmissionDetailSchema,
    MySubmissionListSchema,
    ReadMySubmissionDetailInboundRequestSchema,
    ReadMySubmissionsInboundRequestSchema,
    type MySubmissionDetail,
    type MySubmission,
    type ReadMySubmissionDetailParams,
    type ReadMySubmissionsParams,
} from "../../schemas/expense-report.schema.js";
import {
    findEmployeeSubmissionDetail,
    findExpenseReportsByOwner,
    type EmployeeSubmissionDetailContent,
} from "../repository/expenseReportRepository.js";
import { calculateMileageReimbursement } from "./mileageReimbursement.js";

export type MySubmissionsStore = {
    findByOwner(tenantId: string, ownerId: string): Promise<ExpenseReport[]>;
};

export type MySubmissionsServiceDependencies = {
    now?: () => Date;
    store: MySubmissionsStore;
};

export type MySubmissionDetailStore = {
    findDetail(
        tenantId: string,
        expenseReportId: string,
        ownerId: string,
    ): Promise<EmployeeSubmissionDetailContent | undefined>;
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

/**
 * Reads the line-item and mileage detail for one employee-owned Expense Report.
 */
export async function readMySubmissionDetail(
    request: ReadMySubmissionDetailParams,
    store: MySubmissionDetailStore = {
        findDetail: findEmployeeSubmissionDetail,
    },
): Promise<MySubmissionDetail> {
    const parsedRequest =
        ReadMySubmissionDetailInboundRequestSchema.parse(request);
    const content = await store.findDetail(
        parsedRequest.tenantId,
        parsedRequest.id,
        parsedRequest.ownerId,
    );
    if (content === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const mileageConfig = loadMileageConfig();

    return MySubmissionDetailSchema.parse({
        id: content.report.id,
        currentStage: content.report.currentStage,
        lineItems: content.lineItems.map((item) => ({
            id: item.id,
            merchant: item.merchant,
            expenseDate: item.expenseDate,
            category: item.category,
            amount: Number(item.amount),
            currency: item.currency,
        })),
        mileageEntries: content.mileageEntries.map((entry) => ({
            id: entry.id,
            route: entry.route,
            distance: Number(entry.distance),
            mileageDate: entry.mileageDate,
            reimbursementAmount: calculateMileageReimbursement(
                entry.distance,
                mileageConfig.reimbursementRateDecimal,
            ),
            currency: "USD",
        })),
    });
}

function toUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}
