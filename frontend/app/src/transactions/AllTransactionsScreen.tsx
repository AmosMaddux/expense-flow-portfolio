import { useEffect, useMemo, useState } from "react";
import { type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import {
    ApprovalQueueReviewDialog,
    type ApprovalQueueLineItem,
} from "../caseQueue/CaseQueueScreen";
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
    owner: z.string().uuid(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]),
    dueDate: z.iso.date(),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    glCode: z.string().nullable(),
    flaggedLineItem: z.boolean(),
    reviewAction: z.enum(["approve", "reject"]).nullable(),
});

export const allTransactionListSchema = z.array(allTransactionSchema);

const allTransactionPageSchema = z.object({
    items: allTransactionListSchema,
    nextCursor: z.string().nullable(),
});

const expenseReportReviewDetailSourceSchema = z.object({
    id: z.string().uuid(),
    date: z.iso.date(),
    amount: z.string().regex(/^-?\d+\.\d{2}$/),
    currency: z.string().min(3).max(3),
    glCode: z.string().nullable(),
    flaggedLineItem: z.boolean(),
    reviewAction: z.enum(["approve", "reject"]).nullable(),
    deductible: z.boolean().nullable(),
});

const expenseReportReviewDetailReceiptSchema = z.object({
    id: z.string().uuid(),
    lineItemId: z.string().uuid().nullable(),
    merchant: z.string().min(1),
    receiptDate: z.iso.date(),
    amount: z.coerce.number().nonnegative(),
    filename: z.string().nullable(),
    contentType: z.string().nullable(),
});

const expenseReportReviewDetailSchema = z.object({
    expenseReportId: z.string().uuid(),
    owner: z.string().uuid(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]),
    dueDate: z.iso.date(),
    status: z.enum(EXPENSE_REPORT_STAGES),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    lineItems: z.array(
        expenseReportReviewDetailSourceSchema.extend({
            merchant: z.string().min(1),
            category: z.string().min(1),
        }),
    ),
    mileageEntries: z.array(
        expenseReportReviewDetailSourceSchema.extend({
            route: z.string().min(1),
            distance: z.string().regex(/^\d+\.\d{2}$/),
        }),
    ),
    receipts: z.array(expenseReportReviewDetailReceiptSchema),
});

export type AllTransaction = z.infer<typeof allTransactionSchema>;
export type AllTransactionPage = z.infer<typeof allTransactionPageSchema>;
export type ExpenseReportReviewDetail = z.infer<
    typeof expenseReportReviewDetailSchema
>;
export type LoadedTransactionPage = {
    cursor: string | null;
    page: AllTransactionPage;
};

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
 * Fetches the complete tenant-scoped report detail independent of list filters.
 */
export function useExpenseReportReviewDetail(expenseReportId: string | null) {
    return useExpenseFlowQuery<ExpenseReportReviewDetail>({
        enabled: expenseReportId !== null,
        input:
            expenseReportId === null
                ? "/v1/expense-reports/00000000-0000-4000-8000-000000000000/review-detail"
                : `/v1/expense-reports/${expenseReportId}/review-detail`,
        keyParts: ["expense-report-review-detail", expenseReportId],
        parseResponse: async (response) =>
            expenseReportReviewDetailSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the Finance Admin All Transactions read-model screen.
 */
export function AllTransactionsScreen(): JSX.Element {
    const [draftFilters, setDraftFilters] =
        useState<AllTransactionsFilters>(emptyFilters);
    const [appliedFilters, setAppliedFilters] =
        useState<AllTransactionsFilters>(emptyFilters);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loadedPages, setLoadedPages] = useState<LoadedTransactionPage[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [selectedExpenseReportId, setSelectedExpenseReportId] = useState<
        string | null
    >(null);
    const query = useAllTransactions(appliedFilters, cursor);
    const displayedPages = useMemo(
        () => deriveDisplayedTransactionPages(loadedPages, cursor, query.data),
        [cursor, loadedPages, query.data],
    );
    const transactions = useMemo(
        () => displayedPages.flatMap((loadedPage) => loadedPage.page.items),
        [displayedPages],
    );
    const categories = useMemo(
        () =>
            Array.from(
                new Set(
                    transactions.map((transaction) => transaction.category),
                ),
            ).sort((left, right) => left.localeCompare(right)),
        [transactions],
    );
    const selectedReportQuery = useExpenseReportReviewDetail(
        selectedExpenseReportId,
    );

    const appendPage = (
        page: AllTransactionPage,
        pageCursor: string | null,
    ) => {
        setLoadedPages((currentPages) => {
            const existingPageIndex = currentPages.findIndex(
                (loadedPage) => loadedPage.cursor === pageCursor,
            );
            if (existingPageIndex === -1) {
                return [...currentPages, { cursor: pageCursor, page }];
            }

            const nextPage = currentPages[existingPageIndex + 1];
            const shouldKeepFollowingPages =
                nextPage === undefined || nextPage.cursor === page.nextCursor;
            const updatedPages = currentPages
                .slice(0, existingPageIndex + 1)
                .map((loadedPage, index) =>
                    index === existingPageIndex
                        ? { cursor: pageCursor, page }
                        : loadedPage,
                );

            return shouldKeepFollowingPages
                ? [
                      ...updatedPages,
                      ...currentPages.slice(existingPageIndex + 1),
                  ]
                : updatedPages;
        });
        setNextCursor(page.nextCursor);
    };

    useEffect(() => {
        const page = query.data;
        if (page === undefined) {
            return;
        }

        appendPage(page, cursor);
    }, [cursor, query.data]);

    const resetPagination = () => {
        setCursor(null);
        setNextCursor(null);
        setLoadedPages([]);
    };

    const applyFilters = () => {
        const isReapplyingCurrentFilters = areFiltersEqual(
            draftFilters,
            appliedFilters,
        );
        resetPagination();
        setAppliedFilters(draftFilters);
        if (
            isReapplyingCurrentFilters &&
            cursor === null &&
            query.data !== undefined
        ) {
            appendPage(query.data, null);
        }
    };

    const clearFilters = () => {
        const isClearingCurrentFilters = areFiltersEqual(
            appliedFilters,
            emptyFilters,
        );
        resetPagination();
        setDraftFilters(emptyFilters);
        setAppliedFilters(emptyFilters);
        if (
            isClearingCurrentFilters &&
            cursor === null &&
            query.data !== undefined
        ) {
            appendPage(query.data, null);
        }
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
                filters={draftFilters}
                onApply={applyFilters}
                onChange={setDraftFilters}
                onClear={clearFilters}
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
                        <AllTransactionsTable
                            onOpenReview={setSelectedExpenseReportId}
                            transactions={transactions}
                        />
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
                        {selectedExpenseReportId !== null ? (
                            <TransactionReviewDialog
                                onClose={() => setSelectedExpenseReportId(null)}
                                query={selectedReportQuery}
                                reportId={selectedExpenseReportId}
                            />
                        ) : null}
                    </>
                )}
            </section>
        </section>
    );
}

/**
 * Returns persisted pages plus the active query page while pagination state catches up.
 */
export function deriveDisplayedTransactionPages(
    loadedPages: LoadedTransactionPage[],
    cursor: string | null,
    page: AllTransactionPage | undefined,
): LoadedTransactionPage[] {
    if (
        page === undefined ||
        loadedPages.some((loadedPage) => loadedPage.cursor === cursor)
    ) {
        return loadedPages;
    }

    return [...loadedPages, { cursor, page }];
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

function areFiltersEqual(
    left: AllTransactionsFilters,
    right: AllTransactionsFilters,
): boolean {
    return (
        left.category === right.category &&
        left.status === right.status &&
        left.startDate === right.startDate &&
        left.endDate === right.endDate
    );
}

function AllTransactionsFiltersForm({
    categories,
    filters,
    onApply,
    onChange,
    onClear,
}: {
    categories: string[];
    filters: AllTransactionsFilters;
    onApply: () => void;
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
            onSubmit={(event) => {
                event.preventDefault();
                onApply();
            }}
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
            <div className="all-transactions-filters__actions">
                <Button size="sm" type="submit" variant="primary">
                    Apply
                </Button>
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

function AllTransactionsTable({
    onOpenReview,
    transactions,
}: {
    onOpenReview: (expenseReportId: string) => void;
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
                        <th scope="col">Owner</th>
                        <th scope="col">Merchant</th>
                        <th scope="col">Category</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((transaction) => (
                        <tr key={transaction.id}>
                            <td>{formatDate(transaction.date)}</td>
                            <td>{formatReportOwner(transaction.owner)}</td>
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
                            <td>
                                <Button
                                    onClick={() =>
                                        onOpenReview(
                                            transaction.expenseReportId,
                                        )
                                    }
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                >
                                    Review
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={7}>
                            Showing {transactions.length} line items
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

function TransactionReviewDialog({
    onClose,
    query,
    reportId,
}: {
    onClose: () => void;
    query: UseQueryResult<ExpenseReportReviewDetail, Error>;
    reportId: string;
}): JSX.Element | null {
    const report = query.data;

    if (query.isPending) {
        return (
            <div className="case-queue-dialog__backdrop">
                <section
                    aria-labelledby="all-transactions-review-dialog-heading"
                    aria-modal="true"
                    className="case-queue-dialog"
                    role="dialog"
                >
                    <header className="case-queue-dialog__header">
                        <div>
                            <p className="screen-placeholder__label">
                                Report Review
                            </p>
                            <h3 id="all-transactions-review-dialog-heading">
                                Report {formatReportId(reportId)}
                            </h3>
                        </div>
                        <Button
                            onClick={onClose}
                            size="sm"
                            type="button"
                            variant="secondary"
                        >
                            Close
                        </Button>
                    </header>
                    <LoadingSkeleton label="Loading Report Review" rows={4} />
                </section>
            </div>
        );
    }

    if (query.isError) {
        return (
            <div className="case-queue-dialog__backdrop">
                <section
                    aria-labelledby="all-transactions-review-dialog-heading"
                    aria-modal="true"
                    className="case-queue-dialog"
                    role="dialog"
                >
                    <header className="case-queue-dialog__header">
                        <div>
                            <p className="screen-placeholder__label">
                                Report Review
                            </p>
                            <h3 id="all-transactions-review-dialog-heading">
                                Report {formatReportId(reportId)}
                            </h3>
                        </div>
                        <Button
                            onClick={onClose}
                            size="sm"
                            type="button"
                            variant="secondary"
                        >
                            Close
                        </Button>
                    </header>
                    <ErrorState
                        isRetrying={query.isFetching}
                        message={getReportDetailErrorMessage(query.error)}
                        onRetry={() => {
                            void query.refetch();
                        }}
                        title="Unable to load report review"
                    />
                </section>
            </div>
        );
    }

    if (report === undefined) {
        return null;
    }

    return (
        <ApprovalQueueReviewDialog
            canManageReviewWorkflow={false}
            isActionPending={false}
            lineItems={adaptReportDetailToApprovalQueueLineItems(report)}
            onAdvanceReport={() => undefined}
            onClearFlag={() => undefined}
            onClose={onClose}
            onReviewLineItem={() => undefined}
            onSendBackReport={() => undefined}
            onToggleDeductibility={() => undefined}
        />
    );
}

function adaptReportDetailToApprovalQueueLineItems(
    report: ExpenseReportReviewDetail,
): ApprovalQueueLineItem[] {
    const mileageEntries = report.mileageEntries.map((entry) => ({
        id: entry.id,
        expenseReportId: report.expenseReportId,
        distance: Number(entry.distance),
        mileageDate: entry.date,
        route: entry.route,
        amount: Number(entry.amount),
        glCode: entry.glCode ?? "Unmapped",
        flaggedLineItem: entry.flaggedLineItem,
        policyChecks: buildSyntheticPolicyChecks(entry.flaggedLineItem),
        reviewAction: entry.reviewAction,
        deductible: entry.deductible ?? false,
    }));
    const receiptsByLineItemId = new Map<string, typeof report.receipts>();

    for (const receipt of report.receipts) {
        if (receipt.lineItemId === null) {
            continue;
        }

        const existing = receiptsByLineItemId.get(receipt.lineItemId) ?? [];
        receiptsByLineItemId.set(receipt.lineItemId, [...existing, receipt]);
    }

    return report.lineItems.map((lineItem, index) => ({
        id: lineItem.id,
        sourceType: "line_item",
        expenseReportId: report.expenseReportId,
        employee: report.owner,
        merchant: lineItem.merchant,
        amount: Number(lineItem.amount),
        glCode: lineItem.glCode ?? "Unmapped",
        currentStage: report.status,
        flaggedLineItem: lineItem.flaggedLineItem,
        policyChecks: buildSyntheticPolicyChecks(lineItem.flaggedLineItem),
        reviewAction: lineItem.reviewAction,
        deductible: lineItem.deductible ?? false,
        canAdvance: false,
        reportTotalMileage: mileageEntries.reduce(
            (total, entry) => total + entry.distance,
            0,
        ),
        mileageEntries: index === 0 ? mileageEntries : [],
        receipts: [
            ...(receiptsByLineItemId.get(lineItem.id) ?? []),
            ...(index === 0
                ? report.receipts.filter(
                      (receipt) => receipt.lineItemId === null,
                  )
                : []),
        ],
    }));
}

function buildSyntheticPolicyChecks(
    flaggedLineItem: boolean,
): ApprovalQueueLineItem["policyChecks"] {
    return flaggedLineItem
        ? [
              {
                  code: "amount-threshold",
                  message: "Line item exceeds the $500 review threshold.",
                  state: "uncleared",
              },
          ]
        : [];
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

function formatReportId(expenseReportId: string): string {
    return expenseReportId.slice(0, 8).toUpperCase();
}

function formatReportOwner(owner: string): string {
    return owner.slice(0, 8).toUpperCase();
}

function getAllTransactionsErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The transaction list could not be loaded. Please retry.";
}

function getReportDetailErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The report detail could not be loaded. Please retry.";
}
