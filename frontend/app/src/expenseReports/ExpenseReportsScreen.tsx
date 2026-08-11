import { useMemo, useState } from "react";
import { z } from "zod";

import {
    Button,
    EmptyState,
    ErrorState,
    EXPENSE_REPORT_STAGES,
    LoadingSkeleton,
    StatusBadge,
    type ExpenseReportStage,
} from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";

const expenseReportSummarySchema = z
    .object({
        id: z.uuid(),
        createdAt: z.iso.datetime({ offset: true }),
        employeeId: z.uuid(),
        managerId: z.uuid().nullable(),
        category: z.string().min(1),
        amount: z.string().regex(/^\d+\.\d{2}$/),
        currency: z.string().min(3).max(3),
        status: z.enum(EXPENSE_REPORT_STAGES),
    })
    .strict();

const expenseReportSummaryListSchema = z.array(expenseReportSummarySchema);

const expenseReportReviewDetailSourceSchema = z
    .object({
        id: z.uuid(),
        date: z.iso.date(),
        amount: z.string().regex(/^-?\d+\.\d{2}$/),
        currency: z.string().min(3).max(3),
        glCode: z.string().nullable(),
        flaggedLineItem: z.boolean(),
        reviewAction: z.enum(["approve", "reject"]).nullable(),
        deductible: z.boolean().nullable(),
    })
    .strict();

const expenseReportReviewDetailSchema = z
    .object({
        expenseReportId: z.uuid(),
        owner: z.uuid(),
        priority: z.enum(["Low", "Normal", "High", "Urgent"]),
        dueDate: z.iso.date(),
        status: z.enum(EXPENSE_REPORT_STAGES),
        onHold: z.boolean(),
        isOverdue: z.boolean(),
        lineItems: z.array(
            expenseReportReviewDetailSourceSchema
                .extend({
                    merchant: z.string().min(1),
                    category: z.string().min(1),
                })
                .strict(),
        ),
        mileageEntries: z.array(
            expenseReportReviewDetailSourceSchema
                .extend({
                    route: z.string().min(1),
                    distance: z.string().regex(/^\d+\.\d{2}$/),
                })
                .strict(),
        ),
    })
    .strict();

export type ExpenseReportSummary = z.infer<typeof expenseReportSummarySchema>;
type ExpenseReportReviewDetail = z.infer<
    typeof expenseReportReviewDetailSchema
>;
interface ExpenseReportFilters {
    amountMax: string;
    amountMin: string;
    category: string;
    date: string;
    employee: string;
    statuses: ExpenseReportStage[];
}

const emptyExpenseReportFilters: ExpenseReportFilters = {
    amountMax: "",
    amountMin: "",
    category: "",
    date: "",
    employee: "",
    statuses: [],
};

/**
 * Fetches internal Expense Report summaries for the authenticated tenant.
 */
export function useExpenseReports() {
    return useExpenseFlowQuery<ExpenseReportSummary[]>({
        input: "/v1/expense-reports",
        keyParts: ["expense-reports"],
        parseResponse: async (response) =>
            expenseReportSummaryListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the internal Expense Reports list and review detail drawer.
 */
export function ExpenseReportsScreen(): JSX.Element {
    const query = useExpenseReports();
    const [filters, setFilters] = useState<ExpenseReportFilters>(
        emptyExpenseReportFilters,
    );
    const [selectedReportId, setSelectedReportId] = useState<string | null>(
        null,
    );
    const detailQuery = useExpenseFlowQuery<ExpenseReportReviewDetail>({
        enabled: selectedReportId !== null,
        input:
            selectedReportId === null
                ? "/v1/expense-reports"
                : `/v1/expense-reports/${selectedReportId}/review-detail`,
        keyParts: ["expense-reports", selectedReportId, "review-detail"],
        parseResponse: async (response) =>
            expenseReportReviewDetailSchema.parse(await response.json()),
        staleTime: 15_000,
    });
    const categoryOptions = useMemo(
        () =>
            getUniqueSortedValues(
                (query.data ?? []).map(({ category }) => category),
            ),
        [query.data],
    );
    const filteredReports = useMemo(
        () => filterExpenseReports(query.data ?? [], filters),
        [filters, query.data],
    );
    const hasActiveFilters = hasExpenseReportFilters(filters);

    return (
        <section
            className="expense-reports"
            aria-labelledby="expense-reports-heading"
        >
            <header className="expense-reports__header">
                <div>
                    <p className="screen-placeholder__label">
                        Internal Workspace
                    </p>
                    <h2 id="expense-reports-heading">Expense Reports</h2>
                    <p>
                        Review report-level totals while table updates settle
                        across workflow sources.
                    </p>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Expense Reports" rows={6} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getExpenseReportsErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load Expense Reports"
                />
            ) : query.data.length === 0 ? (
                <EmptyState
                    body="Expense Reports will appear here after employees create drafts or submit reports."
                    title="No Expense Reports yet"
                />
            ) : (
                <>
                    <ExpenseReportsFilterPanel
                        categories={categoryOptions}
                        filters={filters}
                        resultCount={filteredReports.length}
                        totalCount={query.data.length}
                        onChange={setFilters}
                        onClear={() =>
                            setFilters({ ...emptyExpenseReportFilters })
                        }
                    />
                    {filteredReports.length === 0 ? (
                        <EmptyState
                            body="Adjust or clear the filters to see matching Expense Reports."
                            title="No Expense Reports match"
                        />
                    ) : (
                        <ExpenseReportsTable
                            reports={filteredReports}
                            onOpenReview={setSelectedReportId}
                        />
                    )}
                    {hasActiveFilters ? null : (
                        <span className="expense-reports__result-summary">
                            Showing all {query.data.length} Expense Reports.
                        </span>
                    )}
                </>
            )}

            {selectedReportId === null ? null : (
                <ExpenseReportReviewDialog
                    detail={detailQuery.data}
                    error={detailQuery.error}
                    isLoading={detailQuery.isPending}
                    isRetrying={detailQuery.isFetching}
                    onClose={() => setSelectedReportId(null)}
                    onRetry={() => {
                        void detailQuery.refetch();
                    }}
                />
            )}
        </section>
    );
}

function ExpenseReportsFilterPanel({
    categories,
    filters,
    onChange,
    onClear,
    resultCount,
    totalCount,
}: {
    categories: string[];
    filters: ExpenseReportFilters;
    onChange: (filters: ExpenseReportFilters) => void;
    onClear: () => void;
    resultCount: number;
    totalCount: number;
}): JSX.Element {
    const updateFilter = (
        key: Exclude<keyof ExpenseReportFilters, "statuses">,
        value: string,
    ) => {
        onChange({ ...filters, [key]: value });
    };
    const toggleStatus = (status: ExpenseReportStage) => {
        const statuses = filters.statuses.includes(status)
            ? filters.statuses.filter(
                  (currentStatus) => currentStatus !== status,
              )
            : [...filters.statuses, status];

        onChange({ ...filters, statuses });
    };

    return (
        <form
            aria-label="Expense Reports filters"
            className="expense-reports-filters"
            onSubmit={(event) => event.preventDefault()}
        >
            <div className="expense-reports-filters__fields">
                <label>
                    <span>Date</span>
                    <input
                        onChange={(event) =>
                            updateFilter("date", event.target.value)
                        }
                        type="date"
                        value={filters.date}
                    />
                </label>
                <label>
                    <span>Employee</span>
                    <input
                        onChange={(event) =>
                            updateFilter("employee", event.target.value)
                        }
                        placeholder="Employee ID"
                        value={filters.employee}
                    />
                </label>
                <label>
                    <span>Category</span>
                    <input
                        list="expense-report-categories"
                        onChange={(event) =>
                            updateFilter("category", event.target.value)
                        }
                        placeholder="All categories"
                        value={filters.category}
                    />
                    <datalist id="expense-report-categories">
                        {categories.map((category) => (
                            <option key={category} value={category} />
                        ))}
                    </datalist>
                </label>
                <label>
                    <span>Min amount</span>
                    <input
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                            updateFilter("amountMin", event.target.value)
                        }
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        value={filters.amountMin}
                    />
                </label>
                <label>
                    <span>Max amount</span>
                    <input
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                            updateFilter("amountMax", event.target.value)
                        }
                        placeholder="999.99"
                        step="0.01"
                        type="number"
                        value={filters.amountMax}
                    />
                </label>
            </div>
            <fieldset className="expense-reports-filters__statuses">
                <legend>Status</legend>
                {EXPENSE_REPORT_STAGES.map((status) => (
                    <label key={status}>
                        <input
                            checked={filters.statuses.includes(status)}
                            onChange={() => toggleStatus(status)}
                            type="checkbox"
                        />
                        <span>{status}</span>
                    </label>
                ))}
            </fieldset>
            <div className="expense-reports-filters__footer">
                <span aria-live="polite">
                    Showing {resultCount} of {totalCount}
                </span>
                <Button
                    onClick={onClear}
                    size="sm"
                    type="button"
                    variant="secondary"
                >
                    Clear
                </Button>
            </div>
        </form>
    );
}

function ExpenseReportsTable({
    reports,
    onOpenReview,
}: {
    reports: ExpenseReportSummary[];
    onOpenReview: (reportId: string) => void;
}): JSX.Element {
    return (
        <section className="expense-reports-table" aria-label="Expense Reports">
            <div className="expense-reports-table__frame">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Employee</th>
                            <th scope="col">Manager</th>
                            <th scope="col">Category</th>
                            <th scope="col">Amount</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {reports.map((report) => (
                            <tr key={report.id}>
                                <td>
                                    <time dateTime={report.createdAt}>
                                        {formatDate(report.createdAt)}
                                    </time>
                                </td>
                                <td>
                                    <PrincipalCell
                                        label={formatPrincipal(
                                            report.employeeId,
                                        )}
                                        detail={`Report ${formatReportId(
                                            report.id,
                                        )}`}
                                    />
                                </td>
                                <td>
                                    {report.managerId === null ? (
                                        <span className="expense-reports-table__muted">
                                            Pending assignment
                                        </span>
                                    ) : (
                                        formatPrincipal(report.managerId)
                                    )}
                                </td>
                                <td>{report.category}</td>
                                <td>
                                    {formatCurrency(
                                        report.amount,
                                        report.currency,
                                    )}
                                </td>
                                <td>
                                    <StatusBadge
                                        label={report.status}
                                        tone="info"
                                    />
                                </td>
                                <td>
                                    <button
                                        className="button button--secondary button--compact"
                                        type="button"
                                        onClick={() => onOpenReview(report.id)}
                                    >
                                        Review
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function ExpenseReportReviewDialog({
    detail,
    error,
    isLoading,
    isRetrying,
    onClose,
    onRetry,
}: {
    detail: ExpenseReportReviewDetail | undefined;
    error: Error | null;
    isLoading: boolean;
    isRetrying: boolean;
    onClose: () => void;
    onRetry: () => void;
}): JSX.Element {
    return (
        <div className="case-queue-dialog__backdrop">
            <section
                aria-labelledby="expense-report-review-heading"
                className="case-queue-dialog"
                role="dialog"
            >
                <header className="case-queue-dialog__header">
                    <div>
                        <p className="screen-placeholder__label">
                            Report Review
                        </p>
                        <h3 id="expense-report-review-heading">
                            {detail === undefined
                                ? "Expense Report"
                                : `Report ${formatReportId(
                                      detail.expenseReportId,
                                  )}`}
                        </h3>
                    </div>
                    <button
                        className="button button--secondary button--compact"
                        type="button"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </header>

                {isLoading ? (
                    <LoadingSkeleton label="Loading report review" rows={5} />
                ) : error !== null ? (
                    <ErrorState
                        isRetrying={isRetrying}
                        message={getExpenseReportDetailErrorMessage(error)}
                        onRetry={onRetry}
                        title="Unable to load report review"
                    />
                ) : detail === undefined ? null : (
                    <ExpenseReportReviewDetailView detail={detail} />
                )}
            </section>
        </div>
    );
}

function ExpenseReportReviewDetailView({
    detail,
}: {
    detail: ExpenseReportReviewDetail;
}): JSX.Element {
    const total = calculateReviewDetailTotal(detail);

    return (
        <>
            <div className="case-queue-dialog__summary">
                <span>
                    Stage
                    <strong>{detail.status}</strong>
                </span>
                <span>
                    Employee
                    <strong>{formatPrincipal(detail.owner)}</strong>
                </span>
                <span>
                    Total
                    <strong>{formatCurrency(total, "USD")}</strong>
                </span>
            </div>
            <div className="case-queue-dialog__table-wrap">
                <table aria-label="Report review line items">
                    <thead>
                        <tr>
                            <th scope="col">Source</th>
                            <th scope="col">Date</th>
                            <th scope="col">Category</th>
                            <th scope="col">Amount</th>
                            <th scope="col">GL Code</th>
                            <th scope="col">Review</th>
                        </tr>
                    </thead>
                    <tbody>
                        {detail.lineItems.map((item) => (
                            <tr key={item.id}>
                                <th scope="row">{item.merchant}</th>
                                <td>{formatDate(item.date)}</td>
                                <td>{item.category}</td>
                                <td>
                                    {formatCurrency(item.amount, item.currency)}
                                </td>
                                <td>{item.glCode ?? "Pending"}</td>
                                <td>{formatReviewAction(item.reviewAction)}</td>
                            </tr>
                        ))}
                        {detail.mileageEntries.map((entry) => (
                            <tr key={entry.id}>
                                <th scope="row">{entry.route}</th>
                                <td>{formatDate(entry.date)}</td>
                                <td>Mileage</td>
                                <td>
                                    {formatCurrency(
                                        entry.amount,
                                        entry.currency,
                                    )}
                                </td>
                                <td>{entry.glCode ?? "Pending"}</td>
                                <td>
                                    {formatReviewAction(entry.reviewAction)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

function PrincipalCell({
    detail,
    label,
}: {
    detail: string;
    label: string;
}): JSX.Element {
    return (
        <span className="expense-reports-principal">
            <strong>{label}</strong>
            <small>{detail}</small>
        </span>
    );
}

function calculateReviewDetailTotal(detail: ExpenseReportReviewDetail): string {
    const cents = [...detail.lineItems, ...detail.mileageEntries].reduce(
        (total, source) => total + decimalCurrencyToCents(source.amount),
        0,
    );

    return centsToDecimalCurrency(cents);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(value));
}

function formatPrincipal(value: string): string {
    return `Employee ${value.slice(0, 8)}`;
}

function formatReportId(value: string): string {
    return value.slice(0, 8).toUpperCase();
}

function formatCurrency(amount: string, currency: string): string {
    return new Intl.NumberFormat("en-US", {
        currency,
        style: "currency",
    }).format(Number(amount));
}

function formatReviewAction(action: "approve" | "reject" | null): string {
    if (action === "approve") {
        return "Approved";
    }

    if (action === "reject") {
        return "Rejected";
    }

    return "Pending";
}

function decimalCurrencyToCents(amount: string): number {
    const sign = amount.startsWith("-") ? -1 : 1;
    const normalizedAmount = amount.replace("-", "");
    const [dollars = "0", cents = "0"] = normalizedAmount.split(".");

    return sign * (Number(dollars) * 100 + Number(cents.padEnd(2, "0")));
}

function centsToDecimalCurrency(cents: number): string {
    const sign = cents < 0 ? "-" : "";
    const absoluteCents = Math.abs(cents);
    const dollars = Math.floor(absoluteCents / 100);
    const remainder = absoluteCents % 100;

    return `${sign}${dollars}.${remainder.toString().padStart(2, "0")}`;
}

function filterExpenseReports(
    reports: ExpenseReportSummary[],
    filters: ExpenseReportFilters,
): ExpenseReportSummary[] {
    const normalizedEmployee = filters.employee.trim().toLowerCase();
    const normalizedCategory = filters.category.trim().toLowerCase();
    const minimumAmount =
        filters.amountMin === "" ? undefined : Number(filters.amountMin);
    const maximumAmount =
        filters.amountMax === "" ? undefined : Number(filters.amountMax);

    return reports.filter((report) => {
        const reportAmount = Number(report.amount);
        const employeeLabel = formatPrincipal(report.employeeId).toLowerCase();

        return (
            (filters.date === "" ||
                report.createdAt.slice(0, "yyyy-mm-dd".length) ===
                    filters.date) &&
            (normalizedEmployee === "" ||
                report.employeeId.toLowerCase().includes(normalizedEmployee) ||
                employeeLabel.includes(normalizedEmployee)) &&
            (normalizedCategory === "" ||
                report.category.toLowerCase() === normalizedCategory) &&
            (minimumAmount === undefined || reportAmount >= minimumAmount) &&
            (maximumAmount === undefined || reportAmount <= maximumAmount) &&
            (filters.statuses.length === 0 ||
                filters.statuses.includes(report.status))
        );
    });
}

function getUniqueSortedValues(values: string[]): string[] {
    return [...new Set(values)].sort((firstValue, secondValue) =>
        firstValue.localeCompare(secondValue),
    );
}

function hasExpenseReportFilters(filters: ExpenseReportFilters): boolean {
    return (
        filters.amountMax !== "" ||
        filters.amountMin !== "" ||
        filters.category !== "" ||
        filters.date !== "" ||
        filters.employee !== "" ||
        filters.statuses.length > 0
    );
}

function getExpenseReportsErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "Expense Reports could not be loaded. Please try again.";
}

function getExpenseReportDetailErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The selected Expense Report review could not be loaded.";
}
