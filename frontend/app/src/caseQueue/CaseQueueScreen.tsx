import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
    StatusBadge,
    type ExpenseReportStage,
} from "../components";
import { QueryRequestError } from "../query/queryClient";
import {
    hasNoCaseQueueReports,
    normalizeCaseQueueRollups,
    useCaseQueueRollups,
    type CaseQueueStageRollup,
} from "./caseQueueRollups";

export type CaseQueueScreenProps = {
    asOfDate?: string;
};

const reviewRelevantStages = new Set<ExpenseReportStage>([
    "Submitted",
    "Manager Approval",
    "AP Review",
]);

/**
 * Renders the wireframe-aligned Approval Queue workspace.
 */
export function CaseQueueScreen({
    asOfDate = getCurrentLocalDate(),
}: CaseQueueScreenProps): JSX.Element {
    const query = useCaseQueueRollups(asOfDate);
    const rollups = normalizeCaseQueueRollups(query.data ?? []);
    const metrics = calculateCaseQueueMetrics(rollups);
    const hasNoReports =
        query.isSuccess && hasNoCaseQueueReports(query.data ?? []);

    return (
        <section className="case-queue" aria-labelledby="case-queue-heading">
            <header className="case-queue__header">
                <div>
                    <p className="screen-placeholder__label">Approval Queue</p>
                    <h2 id="case-queue-heading">Case Queue</h2>
                </div>
                <label className="case-queue__search">
                    <span>Search reports</span>
                    <input disabled placeholder="Search reports..." />
                </label>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Case Queue" rows={6} />
            ) : query.isError ? (
                <section
                    className="case-queue-table"
                    aria-label="Case Queue stage rollups"
                >
                    <ErrorState
                        isRetrying={query.isFetching}
                        message={getCaseQueueErrorMessage(query.error)}
                        onRetry={() => {
                            void query.refetch();
                        }}
                        title="Unable to load Case Queue"
                    />
                </section>
            ) : (
                <>
                    <CaseQueueSummaryCards metrics={metrics} />
                    <CaseQueueToolbar />
                    <section
                        className="case-queue-table"
                        aria-label="Case Queue stage rollups"
                    >
                        {hasNoReports ? (
                            <EmptyState
                                body="There are no Expense Reports waiting in the Case Queue for the selected date."
                                title="No reports waiting for review"
                            />
                        ) : (
                            <CaseQueueRollupTable rollups={rollups} />
                        )}
                    </section>
                    <CaseQueueSupportPanels />
                </>
            )}
        </section>
    );
}

export function getCurrentLocalDate(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function CaseQueueSummaryCards({
    metrics,
}: {
    metrics: CaseQueueMetrics;
}): JSX.Element {
    return (
        <div className="case-queue-summary" aria-label="Case Queue summary">
            <SummaryCard
                label="Pending Approval"
                value={metrics.pendingApproval}
                helper={`${metrics.submittedCount} submitted, ${metrics.managerApprovalCount} manager, ${metrics.apReviewCount} AP`}
            />
            <SummaryCard
                label="Total Value"
                value="MVP"
                helper="Amount totals require report-detail data"
            />
            <SummaryCard
                label="Overdue Reviews"
                tone="danger"
                value={metrics.overdueReviewCount}
                helper="Reports past their review due date"
            />
            <SummaryCard
                label="Auto-Rejections"
                value="MVP"
                helper="Policy automation is outside this fetch"
            />
        </div>
    );
}

function SummaryCard({
    helper,
    label,
    tone = "neutral",
    value,
}: {
    helper: string;
    label: string;
    tone?: "danger" | "neutral";
    value: number | string;
}): JSX.Element {
    return (
        <article
            className={`case-queue-summary-card case-queue-summary-card--${tone}`}
        >
            <p>{label}</p>
            <strong>{value}</strong>
            <span>{helper}</span>
        </article>
    );
}

function CaseQueueToolbar(): JSX.Element {
    return (
        <div className="case-queue-toolbar" aria-label="Case Queue filters">
            <span>Filter by:</span>
            <button disabled type="button">
                Role: All
            </button>
            <button disabled type="button">
                Department: All
            </button>
            <label>
                <input checked disabled type="checkbox" />
                Amount &gt; $500
            </label>
            <Button disabled size="sm" variant="secondary">
                Sort
            </Button>
            <Button disabled size="sm" variant="secondary">
                Export CSV
            </Button>
        </div>
    );
}

function CaseQueueRollupTable({
    rollups,
}: {
    rollups: CaseQueueStageRollup[];
}): JSX.Element {
    const totalReports = rollups.reduce(
        (total, rollup) => total + rollup.reportCount,
        0,
    );

    return (
        <div className="case-queue-table__frame">
            <table>
                <caption>
                    Stage rollups from the authenticated Case Queue fetch
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Workflow Stage</th>
                        <th scope="col">Reports</th>
                        <th scope="col">Overdue</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {rollups.map((rollup) => (
                        <tr key={rollup.currentStage}>
                            <th scope="row">{rollup.currentStage}</th>
                            <td>{rollup.reportCount}</td>
                            <td>
                                <Badge
                                    tone={
                                        rollup.overdueCount > 0
                                            ? "danger"
                                            : "success"
                                    }
                                >
                                    {rollup.overdueCount}
                                </Badge>
                            </td>
                            <td>
                                <StatusBadge
                                    label={
                                        isReviewRelevantStage(
                                            rollup.currentStage,
                                        ) && rollup.reportCount > 0
                                            ? "Needs review"
                                            : "Clear"
                                    }
                                    tone={
                                        isReviewRelevantStage(
                                            rollup.currentStage,
                                        ) && rollup.reportCount > 0
                                            ? "warning"
                                            : "neutral"
                                    }
                                />
                            </td>
                            <td>
                                <Button disabled size="sm" variant="secondary">
                                    Review
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <footer>
                Showing {rollups.length} workflow stages with {totalReports}{" "}
                total reports
            </footer>
        </div>
    );
}

function CaseQueueSupportPanels(): JSX.Element {
    return (
        <div className="case-queue-support">
            <section className="case-queue-quick-review">
                <div aria-hidden="true">▣</div>
                <h3>Quick Review Mode</h3>
                <p>
                    Process low-risk pending reports in a single batch once
                    report-detail data is available.
                </p>
                <Button disabled>Start Batch Process</Button>
            </section>
            <aside className="case-queue-tip" aria-label="Approval Tip">
                <h3>Approval Tip</h3>
                <p>
                    GL codes starting with '62xx' are Travel &amp;
                    Entertainment. Ensure receipts are attached for entries over
                    $25.
                </p>
                <Button disabled variant="ghost">
                    View Expense Policy
                </Button>
            </aside>
        </div>
    );
}

type CaseQueueMetrics = {
    apReviewCount: number;
    managerApprovalCount: number;
    overdueReviewCount: number;
    pendingApproval: number;
    submittedCount: number;
};

function calculateCaseQueueMetrics(
    rollups: CaseQueueStageRollup[],
): CaseQueueMetrics {
    const submittedCount = getStageReportCount(rollups, "Submitted");
    const managerApprovalCount = getStageReportCount(
        rollups,
        "Manager Approval",
    );
    const apReviewCount = getStageReportCount(rollups, "AP Review");

    return {
        apReviewCount,
        overdueReviewCount: rollups
            .filter((rollup) => isReviewRelevantStage(rollup.currentStage))
            .reduce((total, rollup) => total + rollup.overdueCount, 0),
        managerApprovalCount,
        pendingApproval: submittedCount + managerApprovalCount + apReviewCount,
        submittedCount,
    };
}

function getStageReportCount(
    rollups: CaseQueueStageRollup[],
    stage: ExpenseReportStage,
): number {
    return (
        rollups.find((rollup) => rollup.currentStage === stage)?.reportCount ??
        0
    );
}

function getCaseQueueErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The Case Queue could not be loaded. Retry the request or sign in again if the problem continues.";
}

function isReviewRelevantStage(stage: ExpenseReportStage): boolean {
    return reviewRelevantStages.has(stage);
}
