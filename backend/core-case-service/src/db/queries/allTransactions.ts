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
    expenseDate: string;
    id: string;
};

type AllTransactionWithCursor = AllTransaction & {
    cursorExpenseDate: string;
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
        filters.push(sql`${lineItem.expenseDate} >= ${params.startDate}`);
    }

    if (params.endDate !== undefined) {
        filters.push(sql`${lineItem.expenseDate} <= ${params.endDate}`);
    }

    if (cursor !== undefined) {
        filters.push(sql`(
            ${lineItem.expenseDate} < ${cursor.expenseDate}
            or (
                ${lineItem.expenseDate} = ${cursor.expenseDate}
                and ${lineItem.id} > ${cursor.id}
            )
        )`);
    }

    const pageSize = params.limit;
    const result = await db.execute(sql`
        select
            ${lineItem.id} as "id",
            ${lineItem.expenseReportId} as "expenseReportId",
            ${lineItem.expenseDate} as "date",
            ${lineItem.expenseDate} as "cursorExpenseDate",
            ${lineItem.merchant} as "merchant",
            ${lineItem.category} as "category",
            ${lineItem.amount} as "amount",
            ${lineItem.currency} as "currency",
            ${expenseReport.currentStage} as "status",
            null::boolean as "deductible",
            ${expenseReport.owner} as "owner",
            ${expenseReport.priority} as "priority",
            ${expenseReport.dueDate} as "dueDate",
            ${expenseReport.onHold} as "onHold",
            false as "isOverdue",
            latest_gl_result.gl_account_code as "glCode",
            coalesce(latest_gl_result.flagged_line_item, false) as "flaggedLineItem",
            latest_gl_result.line_item_review_action as "reviewAction"
        from ${lineItem}
        inner join ${expenseReport}
            on ${expenseReport.id} = ${lineItem.expenseReportId}
            and ${expenseReport.tenantId} = ${lineItem.tenantId}
        left join lateral (
            select
                gl_coding_result.gl_account_code,
                gl_coding_result.flagged_line_item,
                gl_coding_result.line_item_review_action
            from gl_coding_result
            where gl_coding_result.tenant_id = ${lineItem.tenantId}
                and gl_coding_result.expense_report_id = ${lineItem.expenseReportId}
                and gl_coding_result.source_type = 'line_item'
                and gl_coding_result.source_id = ${lineItem.id}
            order by gl_coding_result.coded_at desc, gl_coding_result.id desc
            limit 1
        ) latest_gl_result on true
        where ${sql.join(filters, sql` and `)}
        order by ${lineItem.expenseDate} desc, ${lineItem.id} asc
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
        owner: String(row.owner),
        priority: toPriority(row.priority),
        dueDate: toIsoDate(row.dueDate),
        onHold: typeof row.onHold === "boolean" ? row.onHold : false,
        isOverdue:
            typeof row.isOverdue === "boolean" ? row.isOverdue : false,
        glCode: typeof row.glCode === "string" ? row.glCode : null,
        flaggedLineItem:
            typeof row.flaggedLineItem === "boolean"
                ? row.flaggedLineItem
                : false,
        reviewAction: toReviewAction(row.reviewAction),
        cursorExpenseDate: toIsoDate(row.cursorExpenseDate),
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
        owner: transaction.owner,
        priority: transaction.priority,
        dueDate: transaction.dueDate,
        onHold: transaction.onHold,
        isOverdue: transaction.isOverdue,
        glCode: transaction.glCode,
        flaggedLineItem: transaction.flaggedLineItem,
        reviewAction: transaction.reviewAction,
    };
}

function toPriority(value: unknown): "Low" | "Normal" | "High" | "Urgent" {
    if (
        value === "Low" ||
        value === "Normal" ||
        value === "High" ||
        value === "Urgent"
    ) {
        return value;
    }

    return "Normal";
}

function toReviewAction(value: unknown): "approve" | "reject" | null {
    if (value === "approve" || value === "reject") {
        return value;
    }

    return null;
}

function toIsoDateTime(value: unknown): string {
    return `${toIsoDate(value)}T00:00:00.000Z`;
}

function toIsoDate(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
}

function createCursor(
    transaction: AllTransactionWithCursor | undefined,
): string | null {
    if (transaction === undefined) {
        return null;
    }

    return Buffer.from(
        JSON.stringify({
            expenseDate: transaction.cursorExpenseDate,
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
            "expenseDate" in parsed &&
            "id" in parsed &&
            typeof parsed.expenseDate === "string" &&
            typeof parsed.id === "string"
        ) {
            return {
                expenseDate: parsed.expenseDate,
                id: parsed.id,
            };
        }
    } catch {
        // Fall through to the generic cursor error below.
    }

    throw new Error("Invalid All Transactions cursor.");
}
