import { sql, type SQLWrapper } from "drizzle-orm";

import { expenseReport, lineItem } from "../schema/index.js";

export type FinanceDashboardTrendSpendBucket = {
    currency: string;
    spendAmount: string;
};

export type FinanceDashboardTrendPoint = {
    periodStart: string;
    reportCount: number;
    spendByCurrency: FinanceDashboardTrendSpendBucket[];
};

export type ReadFinanceDashboardTrendParams = {
    tenantId: string;
    fromDate: string;
    toDate: string;
};

type FinanceDashboardTrendDatabase = {
    execute(query: SQLWrapper | string): PromiseLike<{
        rows: Record<string, unknown>[];
    }>;
};

/**
 * Reads tenant-scoped report creation volume and line-item spend grouped by UTC day.
 */
export async function readFinanceDashboardTrend(
    db: FinanceDashboardTrendDatabase,
    params: ReadFinanceDashboardTrendParams,
): Promise<FinanceDashboardTrendPoint[]> {
    const utcCreatedDate = sql`(${expenseReport.createdAt} at time zone 'UTC')::date`;
    const utcFromTimestamp = sql`cast(${params.fromDate} as date)::timestamp at time zone 'UTC'`;
    const utcToTimestamp = sql`(cast(${params.toDate} as date) + interval '1 day')::timestamp at time zone 'UTC'`;

    const result = await db.execute(sql`
        with days(period_start) as (
            select generate_series(
                cast(${params.fromDate} as date),
                cast(${params.toDate} as date),
                interval '1 day'
            )::date
        ),
        report_counts as (
            select
                ${utcCreatedDate} as period_start,
                count(${expenseReport.id})::int as report_count
            from ${expenseReport}
            where ${expenseReport.tenantId} = ${params.tenantId}
                and ${expenseReport.createdAt} >= ${utcFromTimestamp}
                and ${expenseReport.createdAt} < ${utcToTimestamp}
            group by ${utcCreatedDate}
        ),
        spend_totals as (
            select
                ${utcCreatedDate} as period_start,
                ${lineItem.currency} as currency,
                sum(${lineItem.amount})::numeric(12, 2)::text as spend_amount
            from ${expenseReport}
            inner join ${lineItem}
                on ${lineItem.tenantId} = ${expenseReport.tenantId}
                and ${lineItem.expenseReportId} = ${expenseReport.id}
            where ${expenseReport.tenantId} = ${params.tenantId}
                and ${expenseReport.createdAt} >= ${utcFromTimestamp}
                and ${expenseReport.createdAt} < ${utcToTimestamp}
            group by ${utcCreatedDate}, ${lineItem.currency}
        )
        select
            days.period_start as "periodStart",
            coalesce(report_counts.report_count, 0)::int as "reportCount",
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'currency', spend_totals.currency,
                        'spendAmount', spend_totals.spend_amount
                    )
                    order by spend_totals.currency
                ) filter (where spend_totals.currency is not null),
                '[]'::jsonb
            ) as "spendByCurrency"
        from days
        left join report_counts
            on report_counts.period_start = days.period_start
        left join spend_totals
            on spend_totals.period_start = days.period_start
        group by days.period_start, report_counts.report_count
        order by days.period_start asc
    `);

    return result.rows.map(toFinanceDashboardTrendPoint);
}

function toFinanceDashboardTrendPoint(
    row: Record<string, unknown>,
): FinanceDashboardTrendPoint {
    return {
        periodStart: String(row.periodStart),
        reportCount: Number(row.reportCount),
        spendByCurrency: parseSpendBuckets(row.spendByCurrency),
    };
}

function parseSpendBuckets(value: unknown): FinanceDashboardTrendSpendBucket[] {
    const buckets: unknown =
        typeof value === "string" ? (JSON.parse(value) as unknown) : value;

    if (!Array.isArray(buckets)) {
        return [];
    }

    return buckets.map((bucket) => {
        const record = bucket as Record<string, unknown>;

        return {
            currency: String(record.currency),
            spendAmount: Number(record.spendAmount).toFixed(2),
        };
    });
}
