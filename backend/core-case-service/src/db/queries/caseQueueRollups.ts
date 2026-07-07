import { sql, type SQLWrapper } from "drizzle-orm";

import { approvedWorkflowStages, expenseReport } from "../schema/index.js";

export type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

export type CaseQueueStageRollup = {
    currentStage: ExpenseReportStage;
    reportCount: number;
    overdueCount: number;
};

export type CaseQueueReport = {
    id: string;
    currentStage: ExpenseReportStage;
    dueDate: string;
    owner: string;
    priority: string;
    onHold: boolean;
    holdReason: string | null;
    isOverdue: boolean;
};

export type ReadCaseQueueStageRollupsParams = {
    tenantId: string;
    asOfDate: string;
};

export type ReadCaseQueueReportsForStageParams =
    ReadCaseQueueStageRollupsParams & {
        currentStage: ExpenseReportStage;
    };

type CaseQueueRollupDatabase = {
    execute(query: SQLWrapper | string): PromiseLike<{
        rows: Record<string, unknown>[];
    }>;
};

const expectedStageValues = sql.join(
    approvedWorkflowStages.map((stage, index) => sql`(${stage}, ${index + 1})`),
    sql`, `,
);

/**
 * Read tenant-scoped Expense Report counts by workflow stage for the Case Queue.
 */
export async function readCaseQueueStageRollups(
    db: CaseQueueRollupDatabase,
    params: ReadCaseQueueStageRollupsParams,
): Promise<CaseQueueStageRollup[]> {
    const result = await db.execute(sql`
        with expected_stages(stage_name, stage_order) as (
            values ${expectedStageValues}
        )
        select
            es.stage_name as "currentStage",
            count(${expenseReport.id})::int as "reportCount",
            count(${expenseReport.id}) filter (
                where ${expenseReport.dueDate} < cast(${params.asOfDate} as date)
            )::int as "overdueCount"
        from expected_stages es
        left join ${expenseReport}
            on es.stage_name = ${expenseReport.currentStage}
            and ${expenseReport.tenantId} = ${params.tenantId}
        group by es.stage_name, es.stage_order
        order by es.stage_order
    `);

    return result.rows.map(toCaseQueueStageRollup);
}

/**
 * Read tenant-scoped Expense Reports in one workflow stage with a derived overdue flag.
 */
export async function readCaseQueueReportsForStage(
    db: CaseQueueRollupDatabase,
    params: ReadCaseQueueReportsForStageParams,
): Promise<CaseQueueReport[]> {
    const result = await db.execute(sql`
        select
            ${expenseReport.id} as "id",
            ${expenseReport.currentStage} as "currentStage",
            ${expenseReport.dueDate} as "dueDate",
            ${expenseReport.owner} as "owner",
            ${expenseReport.priority} as "priority",
            ${expenseReport.onHold} as "onHold",
            ${expenseReport.holdReason} as "holdReason",
            (${expenseReport.dueDate} < cast(${params.asOfDate} as date)) as "isOverdue"
        from ${expenseReport}
        where ${expenseReport.tenantId} = ${params.tenantId}
            and ${expenseReport.currentStage} = ${params.currentStage}
        order by ${expenseReport.dueDate} asc, ${expenseReport.id} asc
    `);

    return result.rows.map(toCaseQueueReport);
}

function toCaseQueueStageRollup(
    row: Record<string, unknown>,
): CaseQueueStageRollup {
    const currentStage = row.currentStage;

    if (
        typeof currentStage !== "string" ||
        !approvedWorkflowStages.includes(currentStage as ExpenseReportStage)
    ) {
        throw new Error("Case Queue rollup query returned an unknown stage");
    }

    return {
        currentStage: currentStage as ExpenseReportStage,
        reportCount: Number(row.reportCount),
        overdueCount: Number(row.overdueCount),
    };
}

function toCaseQueueReport(row: Record<string, unknown>): CaseQueueReport {
    const currentStage = row.currentStage;

    if (
        typeof currentStage !== "string" ||
        !approvedWorkflowStages.includes(currentStage as ExpenseReportStage)
    ) {
        throw new Error("Case Queue report query returned an unknown stage");
    }

    return {
        id: String(row.id),
        currentStage: currentStage as ExpenseReportStage,
        dueDate: String(row.dueDate),
        owner: String(row.owner),
        priority: String(row.priority),
        onHold: Boolean(row.onHold),
        holdReason: typeof row.holdReason === "string" ? row.holdReason : null,
        isOverdue: Boolean(row.isOverdue),
    };
}
