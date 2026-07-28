import { loadMileageConfig } from "../../config/mileageConfig.js";
import type { ExpenseReport } from "../../db/schema/index.js";
import { NotFoundError } from "../../errors/problem-json.js";
import {
    MySubmissionDetailSchema,
    MySubmissionPageSchema,
    MySubmissionsCursorSchema,
    ReadMySubmissionDetailInboundRequestSchema,
    ReadMySubmissionsInboundRequestSchema,
    type MySubmissionDetail,
    type MySubmissionPage,
    type ReadMySubmissionDetailParams,
    type ReadMySubmissionsParams,
} from "../../schemas/expense-report.schema.js";
import {
    findEmployeeSubmissionDetail,
    findExpenseReportsByOwner,
    type EmployeeSubmissionDetailContent,
    type ExpenseReportOwnerCursor,
} from "../repository/expenseReportRepository.js";
import { calculateMileageReimbursement } from "./mileageReimbursement.js";

export type MySubmissionsStore = {
    findByOwner(
        tenantId: string,
        ownerId: string,
        pagination: {
            cursor?: ExpenseReportOwnerCursor;
            limit: number;
        },
    ): Promise<ExpenseReport[]>;
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
): Promise<MySubmissionPage> {
    const parsedRequest = ReadMySubmissionsInboundRequestSchema.parse(request);
    const cursor =
        parsedRequest.cursor === undefined
            ? undefined
            : decodeMySubmissionsCursor(parsedRequest.cursor);
    const reports = await dependencies.store.findByOwner(
        parsedRequest.tenantId,
        parsedRequest.ownerId,
        {
            ...(cursor === undefined ? {} : { cursor }),
            limit: parsedRequest.pageSize + 1,
        },
    );
    const today = toUtcDate(dependencies.now?.() ?? new Date());
    const hasNextPage = reports.length > parsedRequest.pageSize;
    const pageReports = reports.slice(0, parsedRequest.pageSize);
    const lastReport = pageReports.at(-1);

    return MySubmissionPageSchema.parse({
        items: pageReports.map((report) => ({
            id: report.id,
            dueDate: report.dueDate,
            currentStage: report.currentStage,
            onHold: report.onHold,
            isOverdue:
                report.currentStage !== "Reconciled" && report.dueDate < today,
            createdAt: report.createdAt,
            updatedAt: report.updatedAt,
        })),
        nextCursor:
            hasNextPage && lastReport !== undefined
                ? encodeMySubmissionsCursor(lastReport)
                : null,
    });
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

    const mileageEntries =
        content.mileageEntries.length === 0
            ? []
            : mapMileageEntries(
                  content.mileageEntries,
                  loadMileageConfig().reimbursementRateDecimal,
              );

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
        mileageEntries,
    });
}

function encodeMySubmissionsCursor(report: ExpenseReport): string {
    return Buffer.from(
        [
            report.updatedAt.toISOString(),
            report.createdAt.toISOString(),
            report.id,
        ].join("|"),
        "utf8",
    ).toString("base64url");
}

function decodeMySubmissionsCursor(cursor: string): ExpenseReportOwnerCursor {
    const [updatedAt, createdAt, id] = Buffer.from(cursor, "base64url")
        .toString("utf8")
        .split("|");
    const parsed = MySubmissionsCursorSchema.parse({
        updatedAt,
        createdAt,
        id,
    });

    return {
        updatedAt: new Date(parsed.updatedAt),
        createdAt: new Date(parsed.createdAt),
        id: parsed.id,
    };
}

function mapMileageEntries(
    entries: EmployeeSubmissionDetailContent["mileageEntries"],
    reimbursementRateDecimal: string,
): MySubmissionDetail["mileageEntries"] {
    return entries.map((entry) => ({
        id: entry.id,
        route: entry.route,
        distance: Number(entry.distance),
        mileageDate: entry.mileageDate,
        reimbursementAmount: calculateMileageReimbursement(
            entry.distance,
            reimbursementRateDecimal,
        ),
        currency: "USD",
    }));
}

function toUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}
