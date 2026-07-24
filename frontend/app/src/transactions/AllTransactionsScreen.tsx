import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    EXPENSE_REPORT_STAGES,
    LoadingSkeleton,
    StatusBadge,
    type ExpenseReportStage,
} from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";

const allTransactionSchema = z.object({
    id: z.string().uuid(),
    expenseReportId: z.string().uuid(),
    date: z.string().datetime({ offset: true }),
    merchant: z.string().min(1),
    category: z.string().min(1),
    amount: z.string().regex(/^-?\d+\.\d{2}$/),
    currency: z.string().min(3).max(3),
    status: z.enum(EXPENSE_REPORT_STAGES),
    deductible: z.boolean().nullable(),
});

export const allTransactionListSchema = z.array(allTransactionSchema);

const allTransactionPageSchema = z.object({
    items: allTransactionListSchema,
    nextCursor: z.string().nullable(),
});

export type AllTransaction = z.infer<typeof allTransactionSchema>;
export type AllTransactionPage = z.infer<typeof allTransactionPageSchema>;

export type AllTransactionsFilters = {
    category: string;
    status: "" | ExpenseReportStage;
    startDate: string;
    endDate: string;
};

const emptyFilters: AllTransactionsFilters = {
    category: "",
    status: "",
    startDate: "",
    endDate: "",
};

/**
 * Fetches tenant-scoped All Transactions rows for the Finance Admin workspace.
 */
export function useAllTransactions(
    filters: AllTransactionsFilters,
    cursor: string | null,
) {
    const queryString = createAllTransactionsQueryString(filters, cursor);
    const input =
        queryString.length === 0
            ? "/v1/transactions"
            : `/v1/transactions?${queryString}`;

    return useExpenseFlowQuery<AllTransactionPage>({
        input,
        keyParts: ["transactions", filters, cursor],
        parseResponse: async (response) =>
            allTransactionPageSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the Finance Admin All Transactions read-model screen.
 */
export function AllTransactionsScreen(): JSX.Element {
    const [filters, setFilters] =
        useState<AllTransactionsFilters>(emptyFilters);
    const [cursor, setCursor] = useState<string | null>(null);
    const [transactions, setTransactions] = useState<AllTransaction[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const loadedPageKeys = useRef(new Set<string>());
    const query = useAllTransactions(filters, cursor);
    const categories = useMemo(
        () =>
            Array.from(
                new Set(
                    transactions.map((transaction) => transaction.category),
                ),
            ).sort((left, right) => left.localeCompare(right)),
        [transactions],
    );

    useEffect(() => {
        const page = query.data;
        if (page === undefined) {
            return;
        }

        const pageKey = cursor ?? "first";
        if (loadedPageKeys.current.has(pageKey)) {
            setNextCursor(page.nextCursor);
            return;
        }

        loadedPageKeys.current.add(pageKey);
        setTransactions((currentTransactions) =>
            cursor === null
                ? page.items
                : [...currentTransactions, ...page.items],
        );
        setNextCursor(page.nextCursor);
    }, [cursor, query.data]);

    const updateFilters = (nextFilters: AllTransactionsFilters) => {
        loadedPageKeys.current.clear();
        setCursor(null);
        setNextCursor(null);
        setTransactions([]);
        setFilters(nextFilters);
    };

    return (
        <section
            className="all-transactions"
            aria-labelledby="all-transactions-heading"
        >
            <header className="all-transactions__header">
                <div>
                    <p className="screen-placeholder__label">
                        All Transactions
                    </p>
                    <h2 id="all-transactions-heading">Transactions</h2>
                </div>
                <Badge tone="neutral">{transactions.length} rows</Badge>
            </header>

            <AllTransactionsFiltersForm
                categories={categories}
                filters={filters}
                onChange={updateFilters}
                onClear={() => updateFilters(emptyFilters)}
            />

            <section
                className="all-transactions-table"
                aria-label="All Transactions list"
            >
                {query.isPending ? (
                    <LoadingSkeleton
                        label="Loading All Transactions"
                        rows={6}
                    />
                ) : query.isError ? (
                    <ErrorState
                        isRetrying={query.isFetching}
                        message={getAllTransactionsErrorMessage(query.error)}
                        onRetry={() => {
                            void query.refetch();
                        }}
                        title="Unable to load transactions"
                    />
                ) : transactions.length === 0 ? (
                    <EmptyState
                        body="No line items match the selected transaction filters."
                        title="No transactions found"
                    />
                ) : (
                    <>
                        <AllTransactionsTable transactions={transactions} />
                        {nextCursor !== null ? (
                            <div className="all-transactions__pagination">
                                <Button
                                    disabled={query.isFetching}
                                    onClick={() => setCursor(nextCursor)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                >
                                    {query.isFetching
                                        ? "Loading..."
                                        : "Load more"}
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}
            </section>
        </section>
    );
}

export function createAllTransactionsQueryString(
    filters: AllTransactionsFilters,
    cursor: string | null = null,
): string {
    const queryString = new URLSearchParams();
    const category = filters.category.trim();

    if (category.length > 0) {
        queryString.set("category", category);
    }

    if (filters.status.length > 0) {
        queryString.set("status", filters.status);
    }

    if (filters.startDate.length > 0) {
        queryString.set("startDate", filters.startDate);
    }

    if (filters.endDate.length > 0) {
        queryString.set("endDate", filters.endDate);
    }

    if (cursor !== null) {
        queryString.set("cursor", cursor);
    }

    return queryString.toString();
}

function AllTransactionsFiltersForm({
    categories,
    filters,
    onChange,
    onClear,
}: {
    categories: string[];
    filters: AllTransactionsFilters;
    onChange: (filters: AllTransactionsFilters) => void;
    onClear: () => void;
}): JSX.Element {
    const updateFilter = (key: keyof AllTransactionsFilters, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    return (
        <form
            className="all-transactions-filters"
            aria-label="All Transactions filters"
            onSubmit={(event) => event.preventDefault()}
        >
            <label>
                <span>Category</span>
                <input
                    list="all-transactions-categories"
                    onChange={(event) =>
                        updateFilter("category", event.target.value)
                    }
                    placeholder="All categories"
                    value={filters.category}
                />
                <datalist id="all-transactions-categories">
                    {categories.map((category) => (
                        <option key={category} value={category} />
                    ))}
                </datalist>
            </label>
            <label>
                <span>Status</span>
                <select
                    onChange={(event) =>
                        updateFilter("status", event.target.value)
                    }
                    value={filters.status}
                >
                    <option value="">All statuses</option>
                    {EXPENSE_REPORT_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                            {stage}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                <span>Start date</span>
                <input
                    onChange={(event) =>
                        updateFilter("startDate", event.target.value)
                    }
                    type="date"
                    value={filters.startDate}
                />
            </label>
            <label>
                <span>End date</span>
                <input
                    onChange={(event) =>
                        updateFilter("endDate", event.target.value)
                    }
                    type="date"
                    value={filters.endDate}
                />
            </label>
            <Button
                onClick={onClear}
                size="sm"
                type="button"
                variant="secondary"
            >
                Clear
            </Button>
        </form>
    );
}

function AllTransactionsTable({
    transactions,
}: {
    transactions: AllTransaction[];
}): JSX.Element {
    return (
        <div className="all-transactions-table__frame">
            <table>
                <caption>
                    Line items across Expense Reports for the authenticated
                    tenant
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Merchant</th>
                        <th scope="col">Category</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Status</th>
                        <th scope="col">Deductible</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((transaction) => (
                        <tr key={transaction.id}>
                            <td>{formatDate(transaction.date)}</td>
                            <th scope="row">{transaction.merchant}</th>
                            <td>{transaction.category}</td>
                            <td>
                                {formatCurrency(
                                    transaction.amount,
                                    transaction.currency,
                                )}
                            </td>
                            <td>
                                <StatusBadge
                                    label={transaction.status}
                                    tone="neutral"
                                />
                            </td>
                            <td>{formatDeductible(transaction.deductible)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={6}>
                            Showing {transactions.length} line items
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

function formatDate(date: string): string {
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
        year: "numeric",
    }).format(new Date(date));
}

function formatCurrency(amount: string, currency: string): string {
    return new Intl.NumberFormat("en-US", {
        currency,
        style: "currency",
    }).format(Number(amount));
}

function formatDeductible(deductible: boolean | null): string {
    if (deductible === null) {
        return "Not set";
    }

    return deductible ? "Yes" : "No";
}

function getAllTransactionsErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The transaction list could not be loaded. Please retry.";
}
