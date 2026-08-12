import { useEffect, useMemo, useState } from "react";
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
import { ExpenseReportDetailDialog } from "./ExpenseReportDetailDialog";

const expenseReportSummarySchema = z
    .object({
        id: z.uuid(),
        createdAt: z.iso.datetime({ offset: true }),
        employeeId: z.uuid(),
        managerId: z.uuid().nullable(),
        category: z.string().min(1),
        categories: z.array(z.string().min(1)),
        amount: z.string().regex(/^\d+\.\d{2}$/),
        currency: z.string().min(3).max(3),
        status: z.enum(EXPENSE_REPORT_STAGES),
    })
    .strict();

const expenseReportSummaryListSchema = z.array(expenseReportSummarySchema);

export type ExpenseReportSummary = z.infer<typeof expenseReportSummarySchema>;
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
    const categoryOptions = useMemo(
        () =>
            getUniqueSortedValues(
                (query.data ?? []).flatMap(({ categories }) => categories),
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
                <ExpenseReportDetailDialog
                    onClose={() => setSelectedReportId(null)}
                    reportId={selectedReportId}
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
                <CategorySelector
                    categories={categories}
                    value={filters.category}
                    onChange={(category) => updateFilter("category", category)}
                />
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

function CategorySelector({
    categories,
    onChange,
    value,
}: {
    categories: string[];
    onChange: (category: string) => void;
    value: string;
}): JSX.Element {
    const [inputValue, setInputValue] = useState(value);
    const [isOpen, setIsOpen] = useState(false);
    const normalizedInput = inputValue.trim().toLowerCase();
    const matchingCategories = useMemo(
        () =>
            normalizedInput === ""
                ? categories
                : categories.filter((category) =>
                      category.toLowerCase().includes(normalizedInput),
                  ),
        [categories, normalizedInput],
    );

    useEffect(() => {
        setInputValue(value);
    }, [value]);

    const chooseCategory = (category: string) => {
        setInputValue(category);
        setIsOpen(false);
        onChange(category);
    };
    const clearCategory = () => {
        setInputValue("");
        setIsOpen(false);
        onChange("");
    };

    return (
        <div className="expense-reports-filters__category">
            <label htmlFor="expense-report-category">Category</label>
            <div>
                <input
                    aria-autocomplete="list"
                    aria-controls="expense-report-category-options"
                    aria-expanded={isOpen}
                    id="expense-report-category"
                    onBlur={() => setIsOpen(false)}
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        const matchedCategory = categories.find(
                            (category) =>
                                category.toLowerCase() ===
                                nextValue.trim().toLowerCase(),
                        );

                        setInputValue(nextValue);
                        setIsOpen(true);
                        onChange(matchedCategory ?? "");
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder="All categories"
                    role="combobox"
                    type="text"
                    value={inputValue}
                />
                {value === "" && inputValue === "" ? null : (
                    <button type="button" onClick={clearCategory}>
                        Clear category
                    </button>
                )}
            </div>
            {isOpen ? (
                <ul id="expense-report-category-options" role="listbox">
                    {matchingCategories.length === 0 ? (
                        <li>No matching categories</li>
                    ) : (
                        matchingCategories.map((category) => (
                            <li key={category} role="option">
                                <button
                                    onMouseDown={(event) =>
                                        event.preventDefault()
                                    }
                                    onClick={() => chooseCategory(category)}
                                    type="button"
                                >
                                    {category}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            ) : null}
        </div>
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
                report.categories.some(
                    (category) => category.toLowerCase() === normalizedCategory,
                )) &&
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
