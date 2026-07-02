import { sql, type SQLWrapper } from "drizzle-orm";

import { approvedWorkflowStages, expenseReport } from "../schema/index.js";

export type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

export type CaseQueueStageRollup = {
    currentStage: ExpenseReportStage;
    reportCount: number;
    overdueCount: number;
};

export type ReadCaseQueueStageRollupsParams = {
    tenantId: string;
    asOfDate: string;
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

// Reads tenant-scoped Expense Report counts by workflow stage for the Case Queue.
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
                where ${expenseReport.dueDate} < ${params.asOfDate}
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
