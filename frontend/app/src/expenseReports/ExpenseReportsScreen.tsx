import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
const expenseReportSummaryPageSchema = z
    .object({
        items: expenseReportSummaryListSchema,
        nextCursor: z.string().nullable(),
    })
    .strict();

export type ExpenseReportSummary = z.infer<typeof expenseReportSummarySchema>;
type ExpenseReportSummaryPage = z.infer<typeof expenseReportSummaryPageSchema>;
type LoadedExpenseReportPage = {
    cursor: string | null;
    page: ExpenseReportSummaryPage;
};
export interface ExpenseReportFilters {
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
const localStubManagerId = "9f1b3f5c-1dc8-4f37-8a23-000000000002";

/**
 * Fetches internal Expense Report summaries for the authenticated tenant.
 */
export function useExpenseReports(
    filters: ExpenseReportFilters,
    cursor: string | null,
) {
    const queryString = createExpenseReportsQueryString(filters, cursor);
    const input =
        queryString.length === 0
            ? "/v1/expense-reports"
            : `/v1/expense-reports?${queryString}`;

    return useExpenseFlowQuery<ExpenseReportSummaryPage>({
        input,
        keyParts: ["expense-reports", filters, cursor],
        parseResponse: async (response) =>
            expenseReportSummaryPageSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the internal Expense Reports list and review detail drawer.
 */
export function ExpenseReportsScreen(): JSX.Element {
    const [filters, setFilters] = useState<ExpenseReportFilters>(
        emptyExpenseReportFilters,
    );
    const [cursor, setCursor] = useState<string | null>(null);
    const [loadedPages, setLoadedPages] = useState<LoadedExpenseReportPage[]>(
        [],
    );
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [selectedReportId, setSelectedReportId] = useState<string | null>(
        null,
    );
    const query = useExpenseReports(filters, cursor);
    const displayedPages = useMemo(
        () =>
            deriveDisplayedExpenseReportPages(loadedPages, cursor, query.data),
        [cursor, loadedPages, query.data],
    );
    const reports = useMemo(
        () => displayedPages.flatMap((loadedPage) => loadedPage.page.items),
        [displayedPages],
    );
    const categoryOptions = useMemo(
        () =>
            getUniqueSortedValues(
                reports.flatMap(({ categories }) => categories),
            ),
        [reports],
    );
    const hasActiveFilters = hasExpenseReportFilters(filters);
    const resetPagination = () => {
        setCursor(null);
        setNextCursor(null);
        setLoadedPages([]);
    };
    const updateFilters = (nextFilters: ExpenseReportFilters) => {
        resetPagination();
        setFilters(nextFilters);
    };

    useEffect(() => {
        const page = query.data;
        if (page === undefined) {
            return;
        }

        setLoadedPages((currentPages) =>
            appendExpenseReportPage(currentPages, cursor, page),
        );
        setNextCursor(page.nextCursor);
    }, [cursor, query.data]);

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
            ) : reports.length === 0 && !hasActiveFilters ? (
                <EmptyState
                    body="Expense Reports will appear here after employees create drafts or submit reports."
                    title="No Expense Reports yet"
                />
            ) : (
                <>
                    <ExpenseReportsFilterPanel
                        categories={categoryOptions}
                        filters={filters}
                        resultCount={reports.length}
                        onChange={updateFilters}
                        onClear={() =>
                            updateFilters({ ...emptyExpenseReportFilters })
                        }
                    />
                    {reports.length === 0 ? (
                        <EmptyState
                            body="Adjust or clear the filters to see matching Expense Reports."
                            title="No Expense Reports match"
                        />
                    ) : (
                        <ExpenseReportsTable
                            reports={reports}
                            onOpenReview={setSelectedReportId}
                        />
                    )}
                    {nextCursor === null ? null : (
                        <div className="expense-reports__pagination">
                            <Button
                                disabled={query.isFetching}
                                onClick={() => setCursor(nextCursor)}
                                type="button"
                                variant="secondary"
                            >
                                Load more
                            </Button>
                        </div>
                    )}
                    {hasActiveFilters ? (
                        <span className="expense-reports__result-summary">
                            Showing {reports.length} matching Expense Reports.
                        </span>
                    ) : (
                        <span className="expense-reports__result-summary">
                            Showing {reports.length} Expense Reports.
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
}: {
    categories: string[];
    filters: ExpenseReportFilters;
    onChange: (filters: ExpenseReportFilters) => void;
    onClear: () => void;
    resultCount: number;
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
                <span aria-live="polite">Showing {resultCount}</span>
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
    const [activeOptionIndex, setActiveOptionIndex] = useState(0);
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
    useEffect(() => {
        setActiveOptionIndex(0);
    }, [matchingCategories]);

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
    const activeCategory =
        isOpen && matchingCategories.length > 0
            ? matchingCategories[activeOptionIndex]
            : undefined;
    const activeOptionId =
        activeCategory === undefined
            ? undefined
            : getCategoryOptionId(activeCategory);
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveOptionIndex((currentIndex) =>
                matchingCategories.length === 0
                    ? 0
                    : (currentIndex + 1) % matchingCategories.length,
            );
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            setActiveOptionIndex((currentIndex) =>
                matchingCategories.length === 0
                    ? 0
                    : (currentIndex - 1 + matchingCategories.length) %
                      matchingCategories.length,
            );
            return;
        }

        if (event.key === "Enter" && isOpen && activeCategory !== undefined) {
            event.preventDefault();
            chooseCategory(activeCategory);
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            setIsOpen(false);
        }
    };

    return (
        <div className="expense-reports-filters__category">
            <label htmlFor="expense-report-category">Category</label>
            <div className="expense-reports-filters__category-control">
                <input
                    aria-autocomplete="list"
                    aria-activedescendant={activeOptionId}
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
                    onKeyDown={handleKeyDown}
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
                {isOpen ? (
                    <ul
                        className="expense-reports-filters__category-menu"
                        id="expense-report-category-options"
                        role="listbox"
                    >
                        {matchingCategories.length === 0 ? (
                            <li
                                className="expense-reports-filters__category-empty"
                                role="presentation"
                            >
                                No matching categories
                            </li>
                        ) : (
                            matchingCategories.map((category, index) => (
                                <li
                                    aria-selected={category === activeCategory}
                                    id={getCategoryOptionId(category)}
                                    key={category}
                                    role="option"
                                >
                                    <button
                                        className={
                                            category === activeCategory
                                                ? "expense-reports-filters__category-option expense-reports-filters__category-option--active"
                                                : "expense-reports-filters__category-option"
                                        }
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onMouseEnter={() =>
                                            setActiveOptionIndex(index)
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
                                    {formatManager(
                                        report.managerId ?? localStubManagerId,
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

function getCategoryOptionId(category: string): string {
    return `expense-report-category-option-${category
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}`;
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

function formatManager(value: string): string {
    return `Manager ${value.slice(0, 8)}`;
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

function getUniqueSortedValues(values: string[]): string[] {
    return [...new Set(values)].sort((firstValue, secondValue) =>
        firstValue.localeCompare(secondValue),
    );
}

function appendExpenseReportPage(
    loadedPages: LoadedExpenseReportPage[],
    cursor: string | null,
    page: ExpenseReportSummaryPage,
): LoadedExpenseReportPage[] {
    const existingPageIndex = loadedPages.findIndex(
        (loadedPage) => loadedPage.cursor === cursor,
    );

    if (existingPageIndex === -1) {
        return [...loadedPages, { cursor, page }];
    }

    const nextPage = loadedPages[existingPageIndex + 1];
    const shouldKeepFollowingPages =
        nextPage === undefined || nextPage.cursor === page.nextCursor;
    const updatedPages = loadedPages
        .slice(0, existingPageIndex + 1)
        .map((loadedPage, index) =>
            index === existingPageIndex ? { cursor, page } : loadedPage,
        );

    return shouldKeepFollowingPages
        ? [...updatedPages, ...loadedPages.slice(existingPageIndex + 1)]
        : updatedPages;
}

function deriveDisplayedExpenseReportPages(
    loadedPages: LoadedExpenseReportPage[],
    cursor: string | null,
    page: ExpenseReportSummaryPage | undefined,
): LoadedExpenseReportPage[] {
    if (
        page === undefined ||
        loadedPages.some((loadedPage) => loadedPage.cursor === cursor)
    ) {
        return loadedPages;
    }

    return [...loadedPages, { cursor, page }];
}

export function createExpenseReportsQueryString(
    filters: ExpenseReportFilters,
    cursor: string | null = null,
): string {
    const queryString = new URLSearchParams();
    const category = filters.category.trim();
    const employee = filters.employee.trim();

    if (filters.amountMax.length > 0) {
        queryString.set("amountMax", filters.amountMax);
    }

    if (filters.amountMin.length > 0) {
        queryString.set("amountMin", filters.amountMin);
    }

    if (category.length > 0) {
        queryString.set("category", category);
    }

    if (filters.date.length > 0) {
        queryString.set("date", filters.date);
    }

    if (employee.length > 0) {
        queryString.set("employee", employee);
    }

    for (const status of filters.statuses) {
        queryString.append("status", status);
    }

    if (cursor !== null) {
        queryString.set("cursor", cursor);
    }

    return queryString.toString();
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
