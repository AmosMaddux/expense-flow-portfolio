import { sql, type SQLWrapper } from "drizzle-orm";

import {
    approvedWorkflowStages,
    expenseReport,
    lineItem,
} from "../schema/index.js";
import type {
    AllTransaction,
    AllTransactionPage,
    ParsedReadAllTransactionsParams,
} from "../../schemas/expense-report.schema.js";

export type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

type AllTransactionsCursor = {
    createdAt: string;
    id: string;
};

type AllTransactionWithCursor = AllTransaction & {
    cursorCreatedAt: string;
};

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
    params: ParsedReadAllTransactionsParams,
): Promise<AllTransactionPage> {
    const cursor = parseCursor(params.cursor);
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
            sql`${lineItem.createdAt} >= ${toUtcStartOfDay(params.startDate)}::timestamptz`,
        );
    }

    if (params.endDate !== undefined) {
        filters.push(
            sql`${lineItem.createdAt} < ${toUtcExclusiveEndOfDay(params.endDate)}::timestamptz`,
        );
    }

    if (cursor !== undefined) {
        filters.push(sql`(
            ${lineItem.createdAt} < ${cursor.createdAt}
            or (
                ${lineItem.createdAt} = ${cursor.createdAt}
                and ${lineItem.id} > ${cursor.id}
            )
        )`);
    }

    const pageSize = params.limit;
    const result = await db.execute(sql`
        select
            ${lineItem.id} as "id",
            ${lineItem.expenseReportId} as "expenseReportId",
            ${lineItem.createdAt} as "date",
            to_char(${lineItem.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt",
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
        limit ${pageSize + 1}
    `);
    const rows = result.rows.map(toAllTransactionWithCursor);
    const pageRows = rows.slice(0, pageSize);
    const items = pageRows.map(toPublicAllTransaction);

    return {
        items,
        nextCursor:
            rows.length > pageSize
                ? createCursor(pageRows[pageRows.length - 1])
                : null,
    };
}

function toAllTransactionWithCursor(
    row: Record<string, unknown>,
): AllTransactionWithCursor {
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
        cursorCreatedAt: String(row.cursorCreatedAt),
    };
}

function toPublicAllTransaction(
    transaction: AllTransactionWithCursor,
): AllTransaction {
    return {
        id: transaction.id,
        expenseReportId: transaction.expenseReportId,
        date: transaction.date,
        merchant: transaction.merchant,
        category: transaction.category,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        deductible: transaction.deductible,
    };
}

function toIsoDateTime(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString();
    }

    return new Date(String(value)).toISOString();
}

function toUtcStartOfDay(date: string): string {
    return `${date}T00:00:00.000Z`;
}

function toUtcExclusiveEndOfDay(date: string): string {
    const endDate = new Date(`${date}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    return endDate.toISOString();
}

function createCursor(
    transaction: AllTransactionWithCursor | undefined,
): string | null {
    if (transaction === undefined) {
        return null;
    }

    return Buffer.from(
        JSON.stringify({
            createdAt: transaction.cursorCreatedAt,
            id: transaction.id,
        } satisfies AllTransactionsCursor),
    ).toString("base64url");
}

function parseCursor(
    cursor: string | undefined,
): AllTransactionsCursor | undefined {
    if (cursor === undefined) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8"),
        ) as unknown;

        if (
            parsed !== null &&
            typeof parsed === "object" &&
            "createdAt" in parsed &&
            "id" in parsed &&
            typeof parsed.createdAt === "string" &&
            typeof parsed.id === "string"
        ) {
            return {
                createdAt: parsed.createdAt,
                id: parsed.id,
            };
        }
    } catch {
        // Fall through to the generic cursor error below.
    }

    throw new Error("Invalid All Transactions cursor.");
}
