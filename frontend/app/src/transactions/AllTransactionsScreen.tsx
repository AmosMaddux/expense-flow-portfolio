import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
    useMutation,
    useQueryClient,
    type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../auth";
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    EXPENSE_REPORT_STAGES,
    LoadingSkeleton,
    OverdueBadge,
    StageStepper,
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
});

const auditEntrySchema = z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    expenseReportId: z.string().uuid(),
    actorId: z.string().uuid(),
    action: z.string().min(1),
    stageBeforeAction: z.enum(EXPENSE_REPORT_STAGES),
    stageAfterProposedAction: z.enum(EXPENSE_REPORT_STAGES),
    denialReason: z.string().nullable(),
    outcomeReason: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
});

const auditEntryListSchema = z.array(auditEntrySchema);

const caseCommentSchema = z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    expenseReportId: z.string().uuid(),
    authorId: z.string().uuid(),
    body: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
});

const caseCommentListSchema = z.array(caseCommentSchema);

const createCaseCommentRequestSchema = z
    .object({
        body: z.string().trim().min(1).max(5_000),
    })
    .strict();

export type AllTransaction = z.infer<typeof allTransactionSchema>;
export type AllTransactionPage = z.infer<typeof allTransactionPageSchema>;
export type ExpenseReportReviewDetail = z.infer<
    typeof expenseReportReviewDetailSchema
>;
type AuditEntry = z.infer<typeof auditEntrySchema>;
type CaseComment = z.infer<typeof caseCommentSchema>;
type CaseDetailTab = "line-items" | "audit-trail" | "comments";
type LoadedTransactionPage = {
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
 * Fetches append-only Audit Trail entries for the selected Expense Report.
 */
export function useExpenseReportAuditEntries(
    expenseReportId: string | null,
    enabled = true,
) {
    return useExpenseFlowQuery<AuditEntry[]>({
        enabled: enabled && expenseReportId !== null,
        input:
            expenseReportId === null
                ? "/v1/expense-reports/00000000-0000-4000-8000-000000000000/audit-entries"
                : `/v1/expense-reports/${expenseReportId}/audit-entries`,
        keyParts: ["expense-report-audit-entries", expenseReportId],
        parseResponse: async (response) =>
            auditEntryListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Fetches case comments for the selected Expense Report.
 */
export function useExpenseReportComments(
    expenseReportId: string | null,
    enabled = true,
) {
    return useExpenseFlowQuery<CaseComment[]>({
        enabled: enabled && expenseReportId !== null,
        input:
            expenseReportId === null
                ? "/v1/expense-reports/00000000-0000-4000-8000-000000000000/comments"
                : `/v1/expense-reports/${expenseReportId}/comments`,
        keyParts: ["expense-report-comments", expenseReportId],
        parseResponse: async (response) =>
            caseCommentListSchema.parse(await response.json()),
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
    const transactions = useMemo(
        () => loadedPages.flatMap((loadedPage) => loadedPage.page.items),
        [loadedPages],
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
    const session = useSession();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<CaseDetailTab>("line-items");
    const [commentBody, setCommentBody] = useState("");
    const [commentError, setCommentError] = useState<string | null>(null);
    const auditQuery = useExpenseReportAuditEntries(
        reportId,
        activeTab === "audit-trail",
    );
    const commentsQuery = useExpenseReportComments(
        reportId,
        activeTab === "comments",
    );
    const commentMutation = useMutation({
        mutationFn: async (body: string) => {
            const requestBody = createCaseCommentRequestSchema.parse({ body });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${reportId}/comments`,
                {
                    body: JSON.stringify(requestBody),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                },
            );

            if (!response.ok) {
                throw await createTransactionActionError(response);
            }

            return caseCommentSchema.parse(await response.json());
        },
        onError: (error) => {
            setCommentError(getReportDetailErrorMessage(error));
        },
        onSuccess: (comment) => {
            setCommentBody("");
            setCommentError(null);
            queryClient.setQueriesData<CaseComment[]>(
                {
                    predicate: (cachedQuery) =>
                        cachedQuery.queryKey.includes(
                            "expense-report-comments",
                        ) && cachedQuery.queryKey.includes(reportId),
                },
                (current = []) =>
                    current.some(
                        (cachedComment) => cachedComment.id === comment.id,
                    )
                        ? current
                        : [...current, comment],
            );
        },
    });

    const handleSubmitComment = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsed = createCaseCommentRequestSchema.safeParse({
            body: commentBody,
        });
        if (!parsed.success) {
            setCommentError("Enter a comment before posting.");
            return;
        }

        setCommentError(null);
        commentMutation.mutate(parsed.data.body);
    };

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
                            Report Detail
                        </p>
                        <h3 id="all-transactions-review-dialog-heading">
                            Expense Report {formatReportId(reportId)}
                        </h3>
                    </div>
                </header>
                {query.isPending ? (
                    <LoadingSkeleton label="Loading Report Detail" rows={4} />
                ) : query.isError ? (
                    <ErrorState
                        isRetrying={query.isFetching}
                        message={getReportDetailErrorMessage(query.error)}
                        onRetry={() => {
                            void query.refetch();
                        }}
                        title="Unable to load report detail"
                    />
                ) : report === undefined ? null : (
                    <>
                        <div className="all-transactions-detail">
                            <StageStepper
                                className="all-transactions-detail__stepper"
                                currentStage={report.status}
                                onHold={report.onHold}
                            />
                            <aside
                                aria-label="Expense Report case summary"
                                className="all-transactions-detail__panel"
                            >
                                <dl>
                                    <div>
                                        <dt>Owner</dt>
                                        <dd>
                                            {formatReportOwner(report.owner)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Priority</dt>
                                        <dd>
                                            <Badge
                                                tone={getPriorityTone(
                                                    report.priority,
                                                )}
                                            >
                                                {report.priority}
                                            </Badge>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Due date</dt>
                                        <dd>
                                            <time dateTime={report.dueDate}>
                                                {formatDate(report.dueDate)}
                                            </time>
                                            <OverdueBadge
                                                isOverdue={report.isOverdue}
                                            />
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>on_hold</dt>
                                        <dd>
                                            <Badge
                                                tone={
                                                    report.onHold
                                                        ? "warning"
                                                        : "success"
                                                }
                                            >
                                                {report.onHold
                                                    ? "On hold"
                                                    : "Active"}
                                            </Badge>
                                        </dd>
                                    </div>
                                </dl>
                            </aside>
                        </div>
                        <CaseDetailTabs
                            activeTab={activeTab}
                            onChange={setActiveTab}
                        />
                        {activeTab === "line-items" ? (
                            <LineItemsTab report={report} />
                        ) : activeTab === "audit-trail" ? (
                            <AuditTrailTab query={auditQuery} />
                        ) : (
                            <CommentsTab
                                body={commentBody}
                                error={commentError}
                                isSubmitting={commentMutation.isPending}
                                onBodyChange={setCommentBody}
                                onSubmit={handleSubmitComment}
                                query={commentsQuery}
                            />
                        )}
                    </>
                )}
                <footer className="case-queue-dialog__footer">
                    <span />
                    <Button
                        onClick={onClose}
                        size="sm"
                        type="button"
                        variant="secondary"
                    >
                        Exit
                    </Button>
                </footer>
            </section>
        </div>
    );
}

function CaseDetailTabs({
    activeTab,
    onChange,
}: {
    activeTab: CaseDetailTab;
    onChange: (tab: CaseDetailTab) => void;
}): JSX.Element {
    const tabs: Array<{ id: CaseDetailTab; label: string }> = [
        { id: "line-items", label: "Line Items" },
        { id: "audit-trail", label: "Audit Trail" },
        { id: "comments", label: "Comments" },
    ];

    return (
        <div className="case-detail-tabs" role="tablist">
            {tabs.map((tab) => (
                <button
                    aria-selected={activeTab === tab.id}
                    className="case-detail-tabs__tab"
                    key={tab.id}
                    role="tab"
                    type="button"
                    onClick={() => onChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

function LineItemsTab({
    report,
}: {
    report: ExpenseReportReviewDetail;
}): JSX.Element {
    return (
        <div className="case-queue-dialog__table-wrap" role="tabpanel">
            <table aria-label="Expense Report review line items">
                <thead>
                    <tr>
                        <th scope="col">Merchant</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Mileage</th>
                        <th scope="col">GL Code</th>
                        <th scope="col">Flag</th>
                        <th scope="col">Review Status</th>
                    </tr>
                </thead>
                <tbody>
                    {buildReportDetailRows(report).map((row) => (
                        <tr key={row.id}>
                            <th scope="row">{row.merchant}</th>
                            <td>{formatCurrency(row.amount, row.currency)}</td>
                            <td>{row.mileage}</td>
                            <td>{row.glCode ?? "Unmapped"}</td>
                            <td>
                                {row.flaggedLineItem ? (
                                    <Badge tone="warning">Over $500</Badge>
                                ) : (
                                    <Badge tone="success">Clear</Badge>
                                )}
                            </td>
                            <td>{formatReviewAction(row.reviewAction)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AuditTrailTab({
    query,
}: {
    query: UseQueryResult<AuditEntry[], Error>;
}): JSX.Element {
    if (query.isPending) {
        return <LoadingSkeleton label="Loading Audit Trail" rows={3} />;
    }

    if (query.isError) {
        return (
            <ErrorState
                isRetrying={query.isFetching}
                message={getReportDetailErrorMessage(query.error)}
                onRetry={() => {
                    void query.refetch();
                }}
                title="Unable to load Audit Trail"
            />
        );
    }

    const entries = query.data ?? [];

    if (entries.length === 0) {
        return (
            <EmptyState
                body="This Expense Report does not have audit events yet."
                title="No audit events"
            />
        );
    }

    return (
        <ol
            aria-label="Expense Report Audit Trail"
            className="case-detail-audit"
            role="tabpanel"
        >
            {entries.map((entry) => (
                <li className="case-detail-audit__entry" key={entry.id}>
                    <time dateTime={entry.createdAt}>
                        {formatDateTime(entry.createdAt)}
                    </time>
                    <strong>{formatAuditAction(entry.action)}</strong>
                    <span>
                        {entry.stageBeforeAction} to{" "}
                        {entry.stageAfterProposedAction}
                    </span>
                    <small>Actor {formatReportOwner(entry.actorId)}</small>
                    {entry.denialReason === null ? null : (
                        <p>{entry.denialReason}</p>
                    )}
                    {entry.outcomeReason === null ? null : (
                        <p>{entry.outcomeReason}</p>
                    )}
                </li>
            ))}
        </ol>
    );
}

function CommentsTab({
    body,
    error,
    isSubmitting,
    onBodyChange,
    onSubmit,
    query,
}: {
    body: string;
    error: string | null;
    isSubmitting: boolean;
    onBodyChange: (body: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    query: UseQueryResult<CaseComment[], Error>;
}): JSX.Element {
    return (
        <section className="case-detail-comments" role="tabpanel">
            {query.isPending ? (
                <LoadingSkeleton label="Loading Comments" rows={3} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getReportDetailErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load comments"
                />
            ) : (query.data ?? []).length === 0 ? (
                <EmptyState
                    body="No comments have been added to this Expense Report."
                    title="No comments"
                />
            ) : (
                <ol
                    aria-label="Expense Report comments"
                    className="case-detail-comments__thread"
                >
                    {(query.data ?? []).map((comment) => (
                        <li key={comment.id}>
                            <div>
                                <strong>
                                    {formatReportOwner(comment.authorId)}
                                </strong>
                                <time dateTime={comment.createdAt}>
                                    {formatDateTime(comment.createdAt)}
                                </time>
                            </div>
                            <p>{comment.body}</p>
                        </li>
                    ))}
                </ol>
            )}
            <form
                aria-label="Add Expense Report comment"
                className="case-detail-comments__form"
                onSubmit={onSubmit}
            >
                <label>
                    <span>Comment</span>
                    <textarea
                        maxLength={5_000}
                        rows={4}
                        value={body}
                        onChange={(event) =>
                            onBodyChange(event.currentTarget.value)
                        }
                    />
                </label>
                {error === null ? null : (
                    <div className="form-message form-message--error">
                        {error}
                    </div>
                )}
                <Button
                    disabled={isSubmitting}
                    size="sm"
                    type="submit"
                    variant="primary"
                >
                    {isSubmitting ? "Posting..." : "Post comment"}
                </Button>
            </form>
        </section>
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

function formatDateTime(date: string): string {
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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

type ReportDetailRow = {
    id: string;
    merchant: string;
    amount: string;
    currency: string;
    mileage: string;
    glCode: string | null;
    flaggedLineItem: boolean;
    reviewAction: "approve" | "reject" | null;
};

function buildReportDetailRows(
    report: ExpenseReportReviewDetail,
): ReportDetailRow[] {
    return [
        ...report.lineItems.map((lineItem) => ({
            id: lineItem.id,
            merchant: lineItem.merchant,
            amount: lineItem.amount,
            currency: lineItem.currency,
            mileage: "-",
            glCode: lineItem.glCode,
            flaggedLineItem: lineItem.flaggedLineItem,
            reviewAction: lineItem.reviewAction,
        })),
        ...report.mileageEntries.map((entry) => ({
            id: entry.id,
            merchant: entry.route,
            amount: entry.amount,
            currency: entry.currency,
            mileage: `${entry.distance} mi`,
            glCode: entry.glCode,
            flaggedLineItem: entry.flaggedLineItem,
            reviewAction: entry.reviewAction,
        })),
    ];
}

function getPriorityTone(
    priority: ExpenseReportReviewDetail["priority"],
): "neutral" | "info" | "warning" | "danger" {
    if (priority === "Urgent") {
        return "danger";
    }

    if (priority === "High") {
        return "warning";
    }

    if (priority === "Low") {
        return "info";
    }

    return "neutral";
}

function formatReviewAction(
    reviewAction: ReportDetailRow["reviewAction"],
): string {
    if (reviewAction === "approve") {
        return "Approved";
    }

    if (reviewAction === "reject") {
        return "Rejected";
    }

    return "Not reviewed";
}

function formatAuditAction(action: string): string {
    return action
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

async function createTransactionActionError(
    response: Response,
): Promise<QueryRequestError> {
    const body: unknown = await response.json().catch(() => undefined);
    const detail =
        body !== null &&
        typeof body === "object" &&
        "detail" in body &&
        typeof body.detail === "string"
            ? body.detail
            : "The request could not be completed. Please retry.";

    return new QueryRequestError(response.status, detail, body);
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
