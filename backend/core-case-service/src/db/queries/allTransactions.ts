import { sql, type SQLWrapper } from "drizzle-orm";

import {
    approvedWorkflowStages,
    expenseReport,
    lineItem,
} from "../schema/index.js";
import type {
    AllTransaction,
    ReadAllTransactionsParams,
} from "../../schemas/expense-report.schema.js";

export type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

type AllTransactionsDatabase = {
    execute(query: SQLWrapper | string): PromiseLike<{
        rows: Record<string, unknown>[];
    }>;
};

/**
 * Reads tenant-scoped line items across Expense Reports for the All Transactions list.
 */
export async function readAllTransactions(
    db: AllTransactionsDatabase,
    params: ReadAllTransactionsParams,
): Promise<AllTransaction[]> {
    const filters: SQLWrapper[] = [
        sql`${lineItem.tenantId} = ${params.tenantId}`,
        sql`${expenseReport.tenantId} = ${params.tenantId}`,
    ];

    if (params.category !== undefined) {
        filters.push(sql`${lineItem.category} = ${params.category}`);
    }

    if (params.status !== undefined) {
        filters.push(sql`${expenseReport.currentStage} = ${params.status}`);
    }

    if (params.startDate !== undefined) {
        filters.push(
            sql`${lineItem.createdAt} >= cast(${params.startDate} as date)`,
        );
    }

    if (params.endDate !== undefined) {
        filters.push(
            sql`${lineItem.createdAt} < cast(${params.endDate} as date) + interval '1 day'`,
        );
    }

    const result = await db.execute(sql`
        select
            ${lineItem.id} as "id",
            ${lineItem.expenseReportId} as "expenseReportId",
            ${lineItem.createdAt} as "date",
            ${lineItem.merchant} as "merchant",
            ${lineItem.category} as "category",
            ${lineItem.amount} as "amount",
            ${lineItem.currency} as "currency",
            ${expenseReport.currentStage} as "status",
            null::boolean as "deductible"
        from ${lineItem}
        inner join ${expenseReport}
            on ${expenseReport.id} = ${lineItem.expenseReportId}
            and ${expenseReport.tenantId} = ${lineItem.tenantId}
        where ${sql.join(filters, sql` and `)}
        order by ${lineItem.createdAt} desc, ${lineItem.id} asc
    `);

    return result.rows.map(toAllTransaction);
}

function toAllTransaction(row: Record<string, unknown>): AllTransaction {
    const status = row.status;

    if (
        typeof status !== "string" ||
        !approvedWorkflowStages.includes(status as ExpenseReportStage)
    ) {
        throw new Error("All Transactions query returned an unknown status.");
    }

    return {
        id: String(row.id),
        expenseReportId: String(row.expenseReportId),
        date: toIsoDateTime(row.date),
        merchant: String(row.merchant),
        category: String(row.category),
        amount: String(row.amount),
        currency: String(row.currency),
        status: status as ExpenseReportStage,
        deductible: typeof row.deductible === "boolean" ? row.deductible : null,
    };
}

function toIsoDateTime(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return new Date(String(value)).toISOString();
}
