import {
    EmptyState,
    ErrorState,
    LoadingSkeleton,
    type ExpenseReportStage,
} from "../components";
import {
    getCurrentLocalDate,
    hasNoCaseQueueReports,
    normalizeCaseQueueRollups,
    useCaseQueueRollups,
    type CaseQueueStageRollup,
} from "../caseQueue/caseQueueRollups";
import { QueryRequestError } from "../query/queryClient";

export type FinanceDashboardScreenProps = {
    asOfDate?: string;
};

type FinanceDashboardMetrics = {
    overdueTotal: number;
    stageRollups: CaseQueueStageRollup[];
    totalReports: number;
};

/**
 * Renders the Finance Admin dashboard workload KPIs.
 */
export function FinanceDashboardScreen({
    asOfDate = getCurrentLocalDate(),
}: FinanceDashboardScreenProps): JSX.Element {
    const query = useCaseQueueRollups(asOfDate);
    const hasNoReports =
        query.isSuccess && hasNoCaseQueueReports(query.data ?? []);
    const metrics = calculateFinanceDashboardMetrics(query.data ?? []);

    return (
        <section
            className="finance-dashboard"
            aria-labelledby="finance-dashboard-heading"
        >
            <header className="finance-dashboard__header">
                <div>
                    <p className="screen-placeholder__label">
                        Finance Dashboard
                    </p>
                    <h2 id="finance-dashboard-heading">Workload Overview</h2>
                </div>
                <p>
                    Case Queue rollup as of{" "}
                    <time dateTime={asOfDate}>{asOfDate}</time>
                </p>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Finance Dashboard" rows={4} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getFinanceDashboardErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load Finance Dashboard"
                />
            ) : hasNoReports ? (
                <EmptyState
                    body="There are no Expense Reports for this tenant in the Case Queue rollup."
                    title="No Expense Reports to show"
                />
            ) : (
                <FinanceDashboardKpis metrics={metrics} />
            )}
        </section>
    );
}

function FinanceDashboardKpis({
    metrics,
}: {
    metrics: FinanceDashboardMetrics;
}): JSX.Element {
    return (
        <section
            className="finance-dashboard-kpis"
            aria-label="Finance Dashboard KPI cards"
        >
            {metrics.stageRollups.map((rollup) => (
                <FinanceDashboardKpiCard
                    helper={`${rollup.overdueCount} overdue`}
                    key={rollup.currentStage}
                    label={rollup.currentStage}
                    value={rollup.reportCount}
                />
            ))}
            <FinanceDashboardKpiCard
                helper={`${metrics.totalReports} total reports`}
                label="Overdue Total"
                tone={metrics.overdueTotal > 0 ? "danger" : "neutral"}
                value={metrics.overdueTotal}
            />
        </section>
    );
}

function FinanceDashboardKpiCard({
    helper,
    label,
    tone = "neutral",
    value,
}: {
    helper: string;
    label: ExpenseReportStage | "Overdue Total";
    tone?: "danger" | "neutral";
    value: number;
}): JSX.Element {
    return (
        <article
            aria-label={`${label} KPI`}
            className={`finance-dashboard-kpi finance-dashboard-kpi--${tone}`}
        >
            <p>{label}</p>
            <strong>{value}</strong>
            <span>{helper}</span>
        </article>
    );
}

function calculateFinanceDashboardMetrics(
    rollups: CaseQueueStageRollup[],
): FinanceDashboardMetrics {
    const stageRollups = normalizeCaseQueueRollups(rollups);

    return {
        overdueTotal: stageRollups.reduce(
            (total, rollup) => total + rollup.overdueCount,
            0,
        ),
        stageRollups,
        totalReports: stageRollups.reduce(
            (total, rollup) => total + rollup.reportCount,
            0,
        ),
    };
}

function getFinanceDashboardErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The Finance Dashboard could not be loaded. Retry the request or sign in again if the problem continues.";
}
