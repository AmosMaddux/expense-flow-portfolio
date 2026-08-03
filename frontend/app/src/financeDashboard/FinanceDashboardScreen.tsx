import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Legend,
    LinearScale,
    Tooltip,
    type ChartConfiguration,
} from "chart.js";
import { useEffect, useMemo, useRef, useState } from "react";

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
import {
    useFinanceDashboardTrend,
    type FinanceDashboardTrendPoint,
} from "./financeDashboardTrend";

Chart.register(
    BarController,
    CategoryScale,
    LinearScale,
    BarElement,
    Tooltip,
    Legend,
);

export type FinanceDashboardScreenProps = {
    asOfDate?: string;
};

type FinanceDashboardMetrics = {
    overdueTotal: number;
    stageRollups: CaseQueueStageRollup[];
    totalReports: number;
};

type TrendMetric = "volume" | "spend";

/**
 * Renders the Finance Admin dashboard workload KPIs and trend chart.
 */
export function FinanceDashboardScreen({
    asOfDate = getFinanceDashboardAsOfDate(),
}: FinanceDashboardScreenProps): JSX.Element {
    const fromDate = getPriorDate(asOfDate, 29);
    const rollupQuery = useCaseQueueRollups(asOfDate);
    const hasNoReports =
        rollupQuery.isSuccess && hasNoCaseQueueReports(rollupQuery.data ?? []);
    const trendQuery = useFinanceDashboardTrend(
        fromDate,
        asOfDate,
        rollupQuery.isSuccess && !hasNoReports,
    );
    const metrics = calculateFinanceDashboardMetrics(rollupQuery.data ?? []);

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

            {rollupQuery.isPending ? (
                <LoadingSkeleton label="Loading Finance Dashboard" rows={4} />
            ) : rollupQuery.isError ? (
                <ErrorState
                    isRetrying={rollupQuery.isFetching}
                    message={getFinanceDashboardErrorMessage(rollupQuery.error)}
                    onRetry={() => {
                        void rollupQuery.refetch();
                    }}
                    title="Unable to load Finance Dashboard"
                />
            ) : hasNoReports ? (
                <EmptyState
                    body="There are no Expense Reports for this tenant in the Case Queue rollup."
                    title="No Expense Reports to show"
                />
            ) : (
                <>
                    <FinanceDashboardKpis metrics={metrics} />
                    <FinanceDashboardTrendPanel
                        error={trendQuery.error}
                        fromDate={fromDate}
                        isError={trendQuery.isError}
                        isFetching={trendQuery.isFetching}
                        isPending={trendQuery.isPending}
                        onRetry={() => {
                            void trendQuery.refetch();
                        }}
                        points={trendQuery.data ?? []}
                        toDate={asOfDate}
                    />
                </>
            )}
        </section>
    );
}

function getFinanceDashboardAsOfDate(): string {
    return (
        import.meta.env.VITE_FINANCE_DASHBOARD_AS_OF_DATE ??
        getCurrentLocalDate()
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

function FinanceDashboardTrendPanel({
    error,
    fromDate,
    isError,
    isFetching,
    isPending,
    onRetry,
    points,
    toDate,
}: {
    error: Error | null;
    fromDate: string;
    isError: boolean;
    isFetching: boolean;
    isPending: boolean;
    onRetry: () => void;
    points: FinanceDashboardTrendPoint[];
    toDate: string;
}): JSX.Element {
    if (isPending) {
        return (
            <LoadingSkeleton
                label="Loading Finance Dashboard trends"
                rows={3}
            />
        );
    }

    if (isError) {
        return (
            <ErrorState
                isRetrying={isFetching}
                message={getFinanceDashboardErrorMessage(error)}
                onRetry={onRetry}
                title="Unable to load Finance Dashboard trends"
            />
        );
    }

    return (
        <FinanceDashboardTrendChart
            fromDate={fromDate}
            points={points}
            toDate={toDate}
        />
    );
}

function FinanceDashboardTrendChart({
    fromDate,
    points,
    toDate,
}: {
    fromDate: string;
    points: FinanceDashboardTrendPoint[];
    toDate: string;
}): JSX.Element {
    const [metric, setMetric] = useState<TrendMetric>("volume");
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const hasTrendData = points.some(
        (point) => point.reportCount > 0 || getPointSpendTotal(point) > 0,
    );
    const summary = useMemo(
        () => buildTrendSummary(points, fromDate, toDate),
        [fromDate, points, toDate],
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        const registeredChart =
            canvas === null ? null : (Chart.getChart(canvas) ?? null);

        registeredChart?.destroy();
        if (chartRef.current !== null && chartRef.current !== registeredChart) {
            chartRef.current.destroy();
        }
        chartRef.current = null;

        const context = canvas?.getContext("2d") ?? null;

        if (context === null || !hasTrendData) {
            return;
        }

        const chart = new Chart(context, buildTrendChartConfig(points, metric));
        chartRef.current = chart;

        return () => {
            chart.destroy();
            if (chartRef.current === chart) {
                chartRef.current = null;
            }
        };
    }, [hasTrendData, metric, points]);

    return (
        <section
            className="finance-dashboard-chart"
            aria-labelledby="finance-dashboard-chart-heading"
        >
            <div className="finance-dashboard-chart__header">
                <div>
                    <h3 id="finance-dashboard-chart-heading">Report Trends</h3>
                    <p id="finance-dashboard-chart-summary">{summary}</p>
                </div>
                <div
                    className="finance-dashboard-chart__toggle"
                    aria-label="Trend metric"
                    role="group"
                >
                    <button
                        aria-pressed={metric === "volume"}
                        onClick={() => setMetric("volume")}
                        type="button"
                    >
                        Volume
                    </button>
                    <button
                        aria-pressed={metric === "spend"}
                        onClick={() => setMetric("spend")}
                        type="button"
                    >
                        Spend
                    </button>
                </div>
            </div>

            {hasTrendData ? (
                <>
                    <div
                        aria-describedby="finance-dashboard-chart-summary"
                        aria-label="Report trend chart"
                        className="finance-dashboard-chart__canvas"
                        role="img"
                        tabIndex={0}
                    >
                        <canvas ref={canvasRef} />
                    </div>
                    <FinanceDashboardTrendTable points={points} />
                </>
            ) : (
                <EmptyState
                    body="No report volume or spend was recorded for this period."
                    title="No trend data to show"
                />
            )}
        </section>
    );
}

function FinanceDashboardTrendTable({
    points,
}: {
    points: FinanceDashboardTrendPoint[];
}): JSX.Element {
    return (
        <div className="finance-dashboard-chart__table">
            <table>
                <caption>Report volume and spend by day</caption>
                <thead>
                    <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Reports</th>
                        <th scope="col">Spend</th>
                    </tr>
                </thead>
                <tbody>
                    {points.map((point) => (
                        <tr key={point.periodStart}>
                            <th scope="row">{formatDate(point.periodStart)}</th>
                            <td>{point.reportCount}</td>
                            <td>{formatPointSpend(point)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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

function buildTrendChartConfig(
    points: FinanceDashboardTrendPoint[],
    metric: TrendMetric,
): ChartConfiguration<"bar", number[], string> {
    const isSpend = metric === "spend";
    const currencies = getTrendCurrencies(points);

    return {
        type: "bar",
        data: {
            labels: points.map((point) => formatDate(point.periodStart)),
            datasets: isSpend
                ? currencies.map((currency, index) => ({
                      backgroundColor: getSpendColor(index),
                      borderColor: getSpendColor(index),
                      borderWidth: 1,
                      data: points.map((point) =>
                          getPointSpendForCurrency(point, currency),
                      ),
                      label: currency,
                  }))
                : [
                      {
                          backgroundColor: "#334e68",
                          borderColor: "#102a43",
                          borderWidth: 1,
                          data: points.map((point) => point.reportCount),
                          label: "Report volume",
                      },
                  ],
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                legend: { display: isSpend && currencies.length > 1 },
                tooltip: {
                    callbacks: {
                        label: (context) =>
                            isSpend
                                ? `${context.dataset.label}: ${formatCurrencyAmount(
                                      context.parsed.y ?? 0,
                                      context.dataset.label ?? "USD",
                                  )}`
                                : `${context.parsed.y} reports`,
                    },
                },
            },
            responsive: true,
            scales: {
                x: { ticks: { maxRotation: 0 } },
                y: { beginAtZero: true },
            },
        },
    };
}
function buildTrendSummary(
    points: FinanceDashboardTrendPoint[],
    fromDate: string,
    toDate: string,
): string {
    const totalReports = points.reduce(
        (total, point) => total + point.reportCount,
        0,
    );
    const spendTotals = getSpendTotalsByCurrency(points);
    const peak = points.reduce<FinanceDashboardTrendPoint | undefined>(
        (currentPeak, point) =>
            currentPeak === undefined ||
            point.reportCount > currentPeak.reportCount
                ? point
                : currentPeak,
        undefined,
    );

    if (points.length === 0 || peak === undefined || totalReports === 0) {
        return `No report volume or spend from ${formatDate(fromDate)} to ${formatDate(
            toDate,
        )}.`;
    }

    return `${totalReports} reports and ${formatSpendTotals(
        spendTotals,
    )} in spend from ${formatDate(fromDate)} to ${formatDate(
        toDate,
    )}; peak volume was ${peak.reportCount} reports on ${formatDate(
        peak.periodStart,
    )}.`;
}

function getSpendTotalsByCurrency(
    points: FinanceDashboardTrendPoint[],
): Map<string, number> {
    const totals = new Map<string, number>();

    for (const point of points) {
        for (const bucket of point.spendByCurrency) {
            totals.set(
                bucket.currency,
                (totals.get(bucket.currency) ?? 0) + Number(bucket.spendAmount),
            );
        }
    }

    return totals;
}

function formatSpendTotals(totals: Map<string, number>): string {
    if (totals.size === 0) {
        return "$0.00";
    }

    return [...totals.entries()]
        .sort(([leftCurrency], [rightCurrency]) =>
            leftCurrency.localeCompare(rightCurrency),
        )
        .map(([currency, amount]) => formatCurrencyAmount(amount, currency))
        .join(", ");
}

function getTrendCurrencies(points: FinanceDashboardTrendPoint[]): string[] {
    return [
        ...new Set(
            points.flatMap((point) =>
                point.spendByCurrency.map((bucket) => bucket.currency),
            ),
        ),
    ].sort((left, right) => left.localeCompare(right));
}

function getPointSpendTotal(point: FinanceDashboardTrendPoint): number {
    return point.spendByCurrency.reduce(
        (total, bucket) => total + Number(bucket.spendAmount),
        0,
    );
}

function getPointSpendForCurrency(
    point: FinanceDashboardTrendPoint,
    currency: string,
): number {
    return Number(
        point.spendByCurrency.find((bucket) => bucket.currency === currency)
            ?.spendAmount ?? "0.00",
    );
}

function getSpendColor(index: number): string {
    const colors = ["#006c49", "#7c3d00", "#4f46e5", "#8a1c1c"];

    return colors[index % colors.length] ?? colors[0];
}
function getFinanceDashboardErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The Finance Dashboard could not be loaded. Retry the request or sign in again if the problem continues.";
}

function getPriorDate(date: string, daysBack: number): string {
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    parsedDate.setUTCDate(parsedDate.getUTCDate() - daysBack);

    return parsedDate.toISOString().slice(0, 10);
}

function formatDate(date: string): string {
    return new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatPointSpend(point: FinanceDashboardTrendPoint): string {
    return formatSpendTotals(getSpendTotalsByCurrency([point]));
}

function formatCurrencyAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat("en-US", {
        currency,
        style: "currency",
    }).format(amount);
}
