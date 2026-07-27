import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnFiltersState,
    type SortingState,
} from "@tanstack/react-table";
import {
    useMutation,
    useQueryClient,
    type Query,
    type QueryClient,
    type QueryKey,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";

import { useSession } from "../auth";
import {
    Badge,
    EmptyState,
    ErrorState,
    EXPENSE_REPORT_STAGES,
    LoadingSkeleton,
    StatusBadge,
    type ExpenseReportStage,
} from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";

const approvalQueueLineItemSchema = z.object({
    id: z.uuid(),
    expenseReportId: z.uuid(),
    merchant: z.string().min(1),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    currentStage: z.enum(EXPENSE_REPORT_STAGES),
    flaggedLineItem: z.boolean(),
    reviewAction: z.enum(["approve", "reject"]).nullable(),
    canAdvance: z.boolean(),
});

export const approvalQueueLineItemListSchema = z.array(
    approvalQueueLineItemSchema,
);

export type ApprovalQueueLineItem = z.infer<typeof approvalQueueLineItemSchema>;

type FlagFilter = "all" | "flagged" | "clear";
type LineItemReviewAction = NonNullable<ApprovalQueueLineItem["reviewAction"]>;
type LineItemMutationVariables = {
    lineItem: ApprovalQueueLineItem;
    action: LineItemReviewAction;
    reason?: string;
};
type ClearFlagMutationVariables = {
    lineItem: ApprovalQueueLineItem;
    reason: string;
};
type TransitionMutationVariables = {
    expenseReportId: string;
    toStage: ExpenseReportStage;
    reason: string;
};
type QueueSnapshot = Array<[QueryKey, ApprovalQueueLineItem[] | undefined]>;

const reviewLineItemRequestSchema = z
    .object({
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(1).optional(),
    })
    .strict()
    .superRefine((request, context) => {
        if (request.action === "reject" && request.reason === undefined) {
            context.addIssue({
                code: "custom",
                message: "Line-item rejection requires a reason.",
                path: ["reason"],
            });
        }
    });
const clearFlagsRequestSchema = z
    .object({
        sourceIds: z.array(z.uuid()).min(1),
        reason: z.string().trim().min(1),
    })
    .strict();
const transitionExpenseReportRequestSchema = z
    .object({
        toStage: z.enum(EXPENSE_REPORT_STAGES),
        reason: z.string().trim().min(1),
    })
    .strict();
const expenseReportTransitionResponseSchema = z.object({
    id: z.uuid(),
    currentStage: z.enum(EXPENSE_REPORT_STAGES),
});

const approvalQueueLineItemKeyParts = ["case-queue", "line-items"] as const;

/**
 * Fetches authenticated Approval Queue line items for the current tenant.
 */
export function useApprovalQueueLineItems() {
    return useExpenseFlowQuery<ApprovalQueueLineItem[]>({
        input: "/v1/case-queue/line-items",
        keyParts: approvalQueueLineItemKeyParts,
        parseResponse: async (response) =>
            approvalQueueLineItemListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the Department Manager Approval Queue line-item review table.
 */
export function CaseQueueScreen(): JSX.Element {
    const query = useApprovalQueueLineItems();
    const session = useSession();
    const queryClient = useQueryClient();
    const [selectedReportId, setSelectedReportId] = useState<string | null>(
        null,
    );
    const [actionError, setActionError] = useState<string | null>(null);
    const selectedReportLineItems = useMemo(
        () =>
            (query.data ?? []).filter(
                (lineItem) => lineItem.expenseReportId === selectedReportId,
            ),
        [query.data, selectedReportId],
    );
    const reviewMutation = useMutation({
        mutationFn: async ({
            action,
            lineItem,
            reason,
        }: LineItemMutationVariables) => {
            const requestBody = reviewLineItemRequestSchema.parse({
                action,
                ...(reason === undefined ? {} : { reason }),
            });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${lineItem.expenseReportId}/line-items/${lineItem.id}/review`,
                {
                    body: JSON.stringify(requestBody),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                },
            );

            if (!response.ok) {
                throw await createQueueActionError(response);
            }

            return approvalQueueLineItemSchema.parse(await response.json());
        },
        onMutate: async (variables) => {
            setActionError(null);
            await queryClient.cancelQueries(approvalQueueQueryFilter);
            const previousLineItems = readApprovalQueueSnapshots(queryClient);
            setApprovalQueueData(queryClient, (current = []) =>
                current.map((lineItem) =>
                    lineItem.id === variables.lineItem.id
                        ? {
                              ...lineItem,
                              reviewAction: variables.action,
                          }
                        : lineItem,
                ),
            );

            return { previousLineItems };
        },
        onError: (error, _variables, context) => {
            restoreApprovalQueueSnapshots(
                queryClient,
                context?.previousLineItems,
            );
            setActionError(getQueueActionErrorMessage(error));
        },
        onSuccess: (updatedLineItem) => {
            replaceQueueLineItem(queryClient, updatedLineItem);
        },
    });
    const clearFlagMutation = useMutation({
        mutationFn: async ({
            lineItem,
            reason,
        }: ClearFlagMutationVariables) => {
            const requestBody = clearFlagsRequestSchema.parse({
                sourceIds: [lineItem.id],
                reason,
            });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${lineItem.expenseReportId}/flags/clear`,
                {
                    body: JSON.stringify(requestBody),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                },
            );

            if (!response.ok) {
                throw await createQueueActionError(response);
            }
        },
        onMutate: async (variables) => {
            setActionError(null);
            await queryClient.cancelQueries(approvalQueueQueryFilter);
            const previousLineItems = readApprovalQueueSnapshots(queryClient);
            setApprovalQueueData(queryClient, (current = []) =>
                recalculateAdvanceEligibility(
                    current.map((lineItem) =>
                        lineItem.id === variables.lineItem.id
                            ? { ...lineItem, flaggedLineItem: false }
                            : lineItem,
                    ),
                ),
            );

            return { previousLineItems };
        },
        onError: (error, _variables, context) => {
            restoreApprovalQueueSnapshots(
                queryClient,
                context?.previousLineItems,
            );
            setActionError(getQueueActionErrorMessage(error));
        },
    });
    const transitionMutation = useMutation({
        mutationFn: async ({
            expenseReportId,
            reason,
            toStage,
        }: TransitionMutationVariables) => {
            const requestBody = transitionExpenseReportRequestSchema.parse({
                toStage,
                reason,
            });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${expenseReportId}/transitions`,
                {
                    body: JSON.stringify(requestBody),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                },
            );

            if (!response.ok) {
                throw await createQueueActionError(response);
            }

            return expenseReportTransitionResponseSchema.parse(
                await response.json(),
            );
        },
        onMutate: async (variables) => {
            setActionError(null);
            await queryClient.cancelQueries(approvalQueueQueryFilter);
            const previousLineItems = readApprovalQueueSnapshots(queryClient);
            setApprovalQueueData(queryClient, (current = []) =>
                recalculateAdvanceEligibility(
                    current.map((lineItem) =>
                        lineItem.expenseReportId === variables.expenseReportId
                            ? {
                                  ...lineItem,
                                  currentStage: variables.toStage,
                              }
                            : lineItem,
                    ),
                ),
            );

            return { previousLineItems };
        },
        onError: (error, _variables, context) => {
            restoreApprovalQueueSnapshots(
                queryClient,
                context?.previousLineItems,
            );
            setActionError(getQueueActionErrorMessage(error));
        },
        onSuccess: (report) => {
            updateQueueReportStage(queryClient, report);
        },
    });
    const isActionPending =
        reviewMutation.isPending ||
        clearFlagMutation.isPending ||
        transitionMutation.isPending;

    return (
        <section className="case-queue" aria-labelledby="case-queue-heading">
            <header className="case-queue__header">
                <div>
                    <p className="screen-placeholder__label">Approval Queue</p>
                    <h2 id="case-queue-heading">Case Queue</h2>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Approval Queue" rows={6} />
            ) : query.isError ? (
                <section
                    className="case-queue-table"
                    aria-label="Approval Queue line items"
                >
                    <ErrorState
                        isRetrying={query.isFetching}
                        message={getApprovalQueueErrorMessage(query.error)}
                        onRetry={() => {
                            void query.refetch();
                        }}
                        title="Unable to load Approval Queue"
                    />
                </section>
            ) : (
                <>
                    {actionError === null ? null : (
                        <div className="form-message form-message--error">
                            {actionError}
                        </div>
                    )}
                    <ApprovalQueueLineItemTable
                        lineItems={query.data ?? []}
                        onOpenReview={(lineItem) => {
                            setActionError(null);
                            setSelectedReportId(lineItem.expenseReportId);
                        }}
                    />
                    {selectedReportId === null ||
                    selectedReportLineItems.length === 0 ? null : (
                        <ApprovalQueueReviewDialog
                            isActionPending={isActionPending}
                            lineItems={selectedReportLineItems}
                            onAdvanceReport={(lineItem) =>
                                transitionMutation.mutate({
                                    expenseReportId: lineItem.expenseReportId,
                                    toStage: "AP Review",
                                    reason: "manager approved after flag review",
                                })
                            }
                            onClearFlag={(lineItem) => {
                                const reason = window.prompt(
                                    "Reason for clearing this flag",
                                    "reviewed receipt detail",
                                );
                                if (
                                    reason === null ||
                                    reason.trim().length === 0
                                ) {
                                    return;
                                }

                                clearFlagMutation.mutate({
                                    lineItem,
                                    reason: reason.trim(),
                                });
                            }}
                            onClose={() => setSelectedReportId(null)}
                            onReviewLineItem={(lineItem, action) => {
                                let reason: string | undefined;
                                if (action === "reject") {
                                    const promptedReason = window.prompt(
                                        "Reason for rejecting this line item",
                                    );
                                    if (
                                        promptedReason === null ||
                                        promptedReason.trim().length === 0
                                    ) {
                                        return;
                                    }

                                    reason = promptedReason.trim();
                                }

                                reviewMutation.mutate({
                                    lineItem,
                                    action,
                                    ...(reason === undefined ? {} : { reason }),
                                });
                            }}
                            onSendBackReport={(lineItem) => {
                                const reason = window.prompt(
                                    "Reason for sending this report back to Drafted",
                                );
                                if (
                                    reason === null ||
                                    reason.trim().length === 0
                                ) {
                                    return;
                                }

                                transitionMutation.mutate({
                                    expenseReportId: lineItem.expenseReportId,
                                    toStage: "Drafted",
                                    reason: reason.trim(),
                                });
                            }}
                        />
                    )}
                </>
            )}
        </section>
    );
}

function ApprovalQueueLineItemTable({
    lineItems,
    onOpenReview,
}: {
    lineItems: ApprovalQueueLineItem[];
    onOpenReview: (lineItem: ApprovalQueueLineItem) => void;
}): JSX.Element {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const columns = useMemo<ColumnDef<ApprovalQueueLineItem>[]>(
        () => [
            {
                accessorKey: "merchant",
                header: "Employee",
                cell: ({ row }) => (
                    <div className="case-queue-employee">
                        <span className="case-queue-employee__avatar">
                            {getMerchantInitials(row.original.merchant)}
                        </span>
                        <span>
                            <strong>{row.original.merchant}</strong>
                            <small>
                                Report{" "}
                                {getReportDisplayId(
                                    row.original.expenseReportId,
                                )}
                            </small>
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: "expenseReportId",
                header: "Submission",
                cell: ({ getValue }) => (
                    <span className="case-queue-table__muted">
                        {getReportDisplayId(
                            getValue<
                                ApprovalQueueLineItem["expenseReportId"]
                            >(),
                        )}
                    </span>
                ),
            },
            {
                accessorKey: "amount",
                header: "Total Amount",
                cell: ({ getValue }) =>
                    formatCurrency(getValue<ApprovalQueueLineItem["amount"]>()),
                sortDescFirst: false,
                sortingFn: "basic",
            },
            {
                accessorKey: "glCode",
                header: "GL Code",
            },
            {
                accessorKey: "currentStage",
                header: "Stage",
                cell: ({ getValue }) => (
                    <StatusBadge
                        label={getValue<
                            ApprovalQueueLineItem["currentStage"]
                        >()}
                        tone="info"
                    />
                ),
            },
            {
                accessorKey: "flaggedLineItem",
                filterFn: (row, columnId, filterValue) => {
                    if (filterValue === "flagged") {
                        return row.getValue<boolean>(columnId);
                    }

                    if (filterValue === "clear") {
                        return !row.getValue<boolean>(columnId);
                    }

                    return true;
                },
                header: "Flag",
                cell: ({ getValue }) =>
                    getValue<ApprovalQueueLineItem["flaggedLineItem"]>() ? (
                        <Badge tone="warning">Over $500</Badge>
                    ) : (
                        <Badge tone="success">Clear</Badge>
                    ),
            },
            {
                accessorKey: "reviewAction",
                header: "Actions",
                cell: ({ row }) => (
                    <button
                        className="button button--secondary button--compact"
                        type="button"
                        onClick={() => onOpenReview(row.original)}
                    >
                        Review
                    </button>
                ),
            },
        ],
        [onOpenReview],
    );
    const table = useReactTable({
        columns,
        data: lineItems,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        state: {
            columnFilters,
            sorting,
        },
    });
    const stageFilter =
        (table.getColumn("currentStage")?.getFilterValue() as
            ExpenseReportStage | undefined) ?? "all";
    const flagFilter =
        (table.getColumn("flaggedLineItem")?.getFilterValue() as
            FlagFilter | undefined) ?? "all";
    const amountOverThresholdFilter = flagFilter === "flagged";
    const visibleRows = table.getRowModel().rows;

    return (
        <>
            <div
                className="case-queue-toolbar"
                aria-label="Approval Queue filters"
            >
                <div className="case-queue-toolbar__filters">
                    <span>Filter by:</span>
                    <label>
                        <span>Stage</span>
                        <select
                            aria-label="Filter by stage"
                            value={stageFilter}
                            onChange={(event) =>
                                table
                                    .getColumn("currentStage")
                                    ?.setFilterValue(
                                        event.target.value === "all"
                                            ? undefined
                                            : event.target.value,
                                    )
                            }
                        >
                            <option value="all">Stage: All</option>
                            {EXPENSE_REPORT_STAGES.map((stage) => (
                                <option key={stage} value={stage}>
                                    {stage}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="case-queue-toolbar__check">
                        <input
                            aria-label="Filter to amount over 500"
                            checked={amountOverThresholdFilter}
                            type="checkbox"
                            onChange={(event) =>
                                table
                                    .getColumn("flaggedLineItem")
                                    ?.setFilterValue(
                                        event.target.checked
                                            ? "flagged"
                                            : undefined,
                                    )
                            }
                        />
                        <span>Amount &gt; $500</span>
                    </label>
                </div>
                <div className="case-queue-toolbar__actions">
                    <button
                        type="button"
                        onClick={() =>
                            setSorting((current) =>
                                current[0]?.id === "amount" && current[0].desc
                                    ? [{ id: "amount", desc: false }]
                                    : [{ id: "amount", desc: true }],
                            )
                        }
                    >
                        Sort
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            exportApprovalQueueCsv(
                                visibleRows.map((row) => row.original),
                            )
                        }
                    >
                        Export CSV
                    </button>
                </div>
            </div>

            <section
                className="case-queue-table"
                aria-label="Approval Queue line items"
            >
                {lineItems.length === 0 ? (
                    <EmptyState
                        body="There are no line items waiting in the Approval Queue."
                        title="No line items waiting for review"
                    />
                ) : (
                    <div className="case-queue-table__frame">
                        <table aria-label="Approval Queue line items">
                            <thead>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => (
                                            <th key={header.id} scope="col">
                                                {header.isPlaceholder ? null : (
                                                    <button
                                                        className="case-queue-table__sort"
                                                        type="button"
                                                        onClick={header.column.getToggleSortingHandler()}
                                                    >
                                                        {flexRender(
                                                            header.column
                                                                .columnDef
                                                                .header,
                                                            header.getContext(),
                                                        )}
                                                        <span aria-hidden="true">
                                                            {getSortIndicator(
                                                                header.column.getIsSorted(),
                                                            )}
                                                        </span>
                                                    </button>
                                                )}
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            <tbody>
                                {visibleRows.map((row) => (
                                    <tr key={row.id}>
                                        {row.getVisibleCells().map((cell) => (
                                            <td key={cell.id}>
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext(),
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {visibleRows.length === 0 ? (
                            <div
                                className="case-queue-table__empty-filter"
                                role="status"
                            >
                                No line items match the selected filters.
                            </div>
                        ) : null}
                        <footer>
                            Showing {visibleRows.length} of {lineItems.length}{" "}
                            line items
                        </footer>
                    </div>
                )}
            </section>
        </>
    );
}

function ApprovalQueueReviewDialog({
    isActionPending,
    lineItems,
    onAdvanceReport,
    onClearFlag,
    onClose,
    onReviewLineItem,
    onSendBackReport,
}: {
    isActionPending: boolean;
    lineItems: ApprovalQueueLineItem[];
    onAdvanceReport: (lineItem: ApprovalQueueLineItem) => void;
    onClearFlag: (lineItem: ApprovalQueueLineItem) => void;
    onClose: () => void;
    onReviewLineItem: (
        lineItem: ApprovalQueueLineItem,
        action: LineItemReviewAction,
    ) => void;
    onSendBackReport: (lineItem: ApprovalQueueLineItem) => void;
}): JSX.Element {
    const reportLineItem = lineItems[0];

    return (
        <div className="case-queue-dialog__backdrop">
            <section
                aria-labelledby="case-queue-dialog-heading"
                className="case-queue-dialog"
                role="dialog"
            >
                <header className="case-queue-dialog__header">
                    <div>
                        <p className="screen-placeholder__label">
                            Report Review
                        </p>
                        <h3 id="case-queue-dialog-heading">
                            Report{" "}
                            {getReportDisplayId(reportLineItem.expenseReportId)}
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
                <div className="case-queue-dialog__summary">
                    <span>
                        Stage
                        <strong>{reportLineItem.currentStage}</strong>
                    </span>
                    <span>
                        Open flags
                        <strong>
                            {
                                lineItems.filter(
                                    (lineItem) => lineItem.flaggedLineItem,
                                ).length
                            }
                        </strong>
                    </span>
                    <span>
                        Total
                        <strong>
                            {formatCurrency(
                                lineItems.reduce(
                                    (total, lineItem) =>
                                        total + lineItem.amount,
                                    0,
                                ),
                            )}
                        </strong>
                    </span>
                </div>
                <div className="case-queue-dialog__table-wrap">
                    <table aria-label="Report review line items">
                        <thead>
                            <tr>
                                <th scope="col">Merchant</th>
                                <th scope="col">Amount</th>
                                <th scope="col">GL Code</th>
                                <th scope="col">Flag</th>
                                <th scope="col">Review</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lineItems.map((lineItem) => (
                                <tr key={lineItem.id}>
                                    <td>{lineItem.merchant}</td>
                                    <td>{formatCurrency(lineItem.amount)}</td>
                                    <td>{lineItem.glCode}</td>
                                    <td>
                                        {lineItem.flaggedLineItem ? (
                                            <Badge tone="warning">
                                                Over $500
                                            </Badge>
                                        ) : (
                                            <Badge tone="success">Clear</Badge>
                                        )}
                                    </td>
                                    <td>
                                        {getReviewActionLabel(
                                            lineItem.reviewAction,
                                        )}
                                    </td>
                                    <td>
                                        <div className="case-queue-dialog__actions">
                                            <button
                                                className="button button--secondary button--compact"
                                                disabled={isActionPending}
                                                type="button"
                                                onClick={() =>
                                                    onReviewLineItem(
                                                        lineItem,
                                                        "approve",
                                                    )
                                                }
                                            >
                                                Approve
                                            </button>
                                            <button
                                                className="button button--secondary button--compact"
                                                disabled={isActionPending}
                                                type="button"
                                                onClick={() =>
                                                    onReviewLineItem(
                                                        lineItem,
                                                        "reject",
                                                    )
                                                }
                                            >
                                                Reject
                                            </button>
                                            <button
                                                className="button button--secondary button--compact"
                                                disabled={
                                                    isActionPending ||
                                                    !lineItem.flaggedLineItem
                                                }
                                                type="button"
                                                onClick={() =>
                                                    onClearFlag(lineItem)
                                                }
                                            >
                                                Clear flag
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <footer className="case-queue-dialog__footer">
                    <button
                        className="button button--secondary button--compact"
                        disabled={isActionPending || !reportLineItem.canAdvance}
                        type="button"
                        onClick={() => onAdvanceReport(reportLineItem)}
                    >
                        Advance
                    </button>
                    <button
                        className="button button--danger button--compact"
                        disabled={isActionPending}
                        type="button"
                        onClick={() => onSendBackReport(reportLineItem)}
                    >
                        Reject / Send back to Drafted
                    </button>
                </footer>
            </section>
        </div>
    );
}

function getReviewActionLabel(
    reviewAction: ApprovalQueueLineItem["reviewAction"],
): string {
    if (reviewAction === "approve") {
        return "Approved";
    }

    if (reviewAction === "reject") {
        return "Rejected";
    }

    return "Not reviewed";
}

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        currency: "USD",
        style: "currency",
    }).format(amount);
}

function getMerchantInitials(merchant: string): string {
    return merchant
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");
}

function getReportDisplayId(expenseReportId: string): string {
    return expenseReportId.slice(0, 8);
}

function exportApprovalQueueCsv(lineItems: ApprovalQueueLineItem[]): void {
    const header = [
        "Employee",
        "Submission",
        "Total Amount",
        "GL Code",
        "Status",
        "Flag",
        "Review",
    ];
    const rows = lineItems.map((lineItem) => [
        lineItem.merchant,
        getReportDisplayId(lineItem.expenseReportId),
        formatCurrency(lineItem.amount),
        lineItem.glCode,
        lineItem.currentStage,
        lineItem.flaggedLineItem ? "Amount > $500" : "Clear",
        getReviewActionLabel(lineItem.reviewAction),
    ]);
    const csv = [header, ...rows]
        .map((row) => row.map(formatCsvCell).join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "approval-queue.csv";
    link.click();
    URL.revokeObjectURL(url);
}

function formatCsvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

function getApprovalQueueErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The Approval Queue could not be loaded. Retry the request or sign in again if the problem continues.";
}

function getSortIndicator(sortDirection: false | "asc" | "desc"): string {
    if (sortDirection === "asc") {
        return " ^";
    }

    if (sortDirection === "desc") {
        return " v";
    }

    return "";
}

const approvalQueueQueryFilter = {
    predicate: (query: Query): boolean =>
        query.queryKey.includes("case-queue") &&
        query.queryKey.includes("line-items"),
};

function readApprovalQueueSnapshots(queryClient: QueryClient): QueueSnapshot {
    return queryClient.getQueriesData<ApprovalQueueLineItem[]>(
        approvalQueueQueryFilter,
    );
}

function restoreApprovalQueueSnapshots(
    queryClient: QueryClient,
    snapshots: QueueSnapshot | undefined,
): void {
    for (const [queryKey, lineItems] of snapshots ?? []) {
        queryClient.setQueryData(queryKey, lineItems);
    }
}

function setApprovalQueueData(
    queryClient: QueryClient,
    updater: (
        current: ApprovalQueueLineItem[] | undefined,
    ) => ApprovalQueueLineItem[],
): void {
    queryClient.setQueriesData<ApprovalQueueLineItem[]>(
        approvalQueueQueryFilter,
        updater,
    );
}

function replaceQueueLineItem(
    queryClient: QueryClient,
    updatedLineItem: ApprovalQueueLineItem,
): void {
    setApprovalQueueData(queryClient, (current = []) =>
        recalculateAdvanceEligibility(
            current.map((lineItem) =>
                lineItem.id === updatedLineItem.id ? updatedLineItem : lineItem,
            ),
        ),
    );
}

function updateQueueReportStage(
    queryClient: QueryClient,
    report: z.infer<typeof expenseReportTransitionResponseSchema>,
): void {
    setApprovalQueueData(queryClient, (current = []) =>
        recalculateAdvanceEligibility(
            current.map((lineItem) =>
                lineItem.expenseReportId === report.id
                    ? {
                          ...lineItem,
                          currentStage: report.currentStage,
                      }
                    : lineItem,
            ),
        ),
    );
}

function recalculateAdvanceEligibility(
    lineItems: ApprovalQueueLineItem[],
): ApprovalQueueLineItem[] {
    const openFlagCounts = new Map<string, number>();
    for (const lineItem of lineItems) {
        if (lineItem.flaggedLineItem) {
            openFlagCounts.set(
                lineItem.expenseReportId,
                (openFlagCounts.get(lineItem.expenseReportId) ?? 0) + 1,
            );
        }
    }

    return lineItems.map((lineItem) => ({
        ...lineItem,
        canAdvance:
            lineItem.currentStage === "Manager Approval" &&
            (openFlagCounts.get(lineItem.expenseReportId) ?? 0) === 0,
    }));
}

async function createQueueActionError(
    response: Response,
): Promise<QueryRequestError> {
    const body: unknown = await response.json().catch(() => undefined);

    return new QueryRequestError(
        response.status,
        getProblemDetail(body) ?? response.statusText,
        body,
    );
}

function getProblemDetail(body: unknown): string | undefined {
    if (body === null || typeof body !== "object") {
        return undefined;
    }

    const detail = (body as Record<string, unknown>).detail;

    return typeof detail === "string" && detail.length > 0 ? detail : undefined;
}

function getQueueActionErrorMessage(error: unknown): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The queue action could not be completed. Retry the action or refresh the queue.";
}
