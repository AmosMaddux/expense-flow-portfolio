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

const policyCheckSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    state: z.enum(["cleared", "uncleared"]),
});

const approvalQueueMileageEntrySchema = z.object({
    id: z.uuid(),
    expenseReportId: z.uuid(),
    route: z.string().min(1),
    distance: z.coerce.number().positive(),
    mileageDate: z.iso.date(),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    flaggedLineItem: z.boolean(),
    policyChecks: z.array(policyCheckSchema),
    reviewAction: z.enum(["approve", "reject"]).nullable(),
    deductible: z.boolean(),
});

const approvalQueueLineItemSchema = z.object({
    id: z.uuid(),
    sourceType: z.enum(["line_item", "mileage"]),
    expenseReportId: z.uuid(),
    employee: z.uuid(),
    merchant: z.string().min(1),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    currentStage: z.enum(EXPENSE_REPORT_STAGES),
    flaggedLineItem: z.boolean(),
    policyChecks: z.array(policyCheckSchema),
    reviewAction: z.enum(["approve", "reject"]).nullable(),
    deductible: z.boolean(),
    canAdvance: z.boolean(),
    reportTotalMileage: z.coerce.number().nonnegative(),
    mileageEntries: z.array(approvalQueueMileageEntrySchema),
});

export const approvalQueueLineItemListSchema = z.array(
    approvalQueueLineItemSchema,
);

export type ApprovalQueueLineItem = z.infer<typeof approvalQueueLineItemSchema>;

export type ReviewDialogPermissions = {
    canAdvanceReport: boolean;
    canClearPolicyChecks: boolean;
    canEditDeductibility: boolean;
    canReviewLineItems: boolean;
    canSendBackReport: boolean;
};

/**
 * Resolves report-detail edit permissions from the authenticated capability and workflow stage.
 */
export function getReviewDialogPermissions(
    canManageReviewWorkflow: boolean,
    currentStage: ExpenseReportStage,
): ReviewDialogPermissions {
    const canEditManagerApproval =
        canManageReviewWorkflow && currentStage === "Manager Approval";

    return {
        canAdvanceReport: canEditManagerApproval,
        canClearPolicyChecks: canEditManagerApproval,
        canEditDeductibility:
            canManageReviewWorkflow && currentStage === "AP Review",
        canReviewLineItems: canEditManagerApproval,
        canSendBackReport: canEditManagerApproval,
    };
}

type ApprovalQueueReportRow = {
    expenseReportId: string;
    employee: string;
    currentStage: ExpenseReportStage;
    flaggedLineItem: boolean;
    totalAmount: number;
    totalMileage: number;
    lineItems: ApprovalQueueLineItem[];
};
type ApprovalQueueReviewRow =
    | {
          type: "line_item";
          id: string;
          merchant: string;
          amount: number;
          mileage: number;
          glCode: string;
          flaggedLineItem: boolean;
          policyChecks: z.infer<typeof policyCheckSchema>[];
          reviewAction: ApprovalQueueLineItem["reviewAction"];
          deductible: boolean;
          lineItem: ApprovalQueueLineItem;
      }
    | {
          type: "mileage";
          id: string;
          merchant: string;
          amount: number;
          mileage: number;
          glCode: string;
          flaggedLineItem: boolean;
          policyChecks: z.infer<typeof policyCheckSchema>[];
          reviewAction: ApprovalQueueLineItem["reviewAction"];
          deductible: boolean;
          lineItem: ApprovalQueueLineItem;
      };
type FlagFilter = "all" | "flagged" | "clear";
type ReportDetailTab = "line-items" | "policy-checks";
type LineItemReviewAction = NonNullable<ApprovalQueueLineItem["reviewAction"]>;
type LineItemMutationVariables = {
    lineItem: ApprovalQueueLineItem;
    sourceId: string;
    sourceType: "line_item" | "mileage";
    action: LineItemReviewAction;
    reason?: string;
};
type ClearFlagMutationVariables = {
    lineItem: ApprovalQueueLineItem;
    sourceId: string;
    reason: string;
};
type DeductibilityMutationVariables = {
    lineItem: ApprovalQueueLineItem;
    sourceId: string;
    sourceType: "line_item" | "mileage";
    deductible: boolean;
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
const updateDeductibilityRequestSchema = z
    .object({
        deductible: z.boolean(),
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
            sourceId,
            sourceType,
        }: LineItemMutationVariables) => {
            const requestBody = reviewLineItemRequestSchema.parse({
                action,
                ...(reason === undefined ? {} : { reason }),
            });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${lineItem.expenseReportId}/sources/${sourceType}/${sourceId}/review`,
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
                    lineItem.id === variables.lineItem.id &&
                    variables.sourceId === lineItem.id
                        ? {
                              ...lineItem,
                              reviewAction: variables.action,
                          }
                        : lineItem.id === variables.lineItem.id
                          ? {
                                ...lineItem,
                                mileageEntries: lineItem.mileageEntries.map(
                                    (entry) =>
                                        entry.id === variables.sourceId
                                            ? {
                                                  ...entry,
                                                  reviewAction:
                                                      variables.action,
                                              }
                                            : entry,
                                ),
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
            sourceId,
        }: ClearFlagMutationVariables) => {
            const requestBody = clearFlagsRequestSchema.parse({
                sourceIds: [sourceId],
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
                            ? {
                                  ...lineItem,
                                  ...(variables.sourceId === lineItem.id
                                      ? {
                                            flaggedLineItem: false,
                                            policyChecks:
                                                markPolicyChecksCleared(
                                                    lineItem.policyChecks,
                                                ),
                                        }
                                      : {}),
                                  mileageEntries: lineItem.mileageEntries.map(
                                      (entry) =>
                                          entry.id === variables.sourceId
                                              ? {
                                                    ...entry,
                                                    flaggedLineItem: false,
                                                    policyChecks:
                                                        markPolicyChecksCleared(
                                                            entry.policyChecks,
                                                        ),
                                                }
                                              : entry,
                                  ),
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
    });
    const deductibilityMutation = useMutation({
        mutationFn: async ({
            deductible,
            lineItem,
            sourceId,
            sourceType,
        }: DeductibilityMutationVariables) => {
            const requestBody = updateDeductibilityRequestSchema.parse({
                deductible,
            });
            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${lineItem.expenseReportId}/sources/${sourceType}/${sourceId}/deductibility`,
                {
                    body: JSON.stringify(requestBody),
                    headers: { "Content-Type": "application/json" },
                    method: "PATCH",
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
                    lineItem.id === variables.lineItem.id &&
                    variables.sourceId === lineItem.id
                        ? {
                              ...lineItem,
                              deductible: variables.deductible,
                          }
                        : lineItem.id === variables.lineItem.id
                          ? {
                                ...lineItem,
                                mileageEntries: lineItem.mileageEntries.map(
                                    (entry) =>
                                        entry.id === variables.sourceId
                                            ? {
                                                  ...entry,
                                                  deductible:
                                                      variables.deductible,
                                              }
                                            : entry,
                                ),
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
                updateQueueReportStageInLineItems(
                    current,
                    variables.expenseReportId,
                    variables.toStage,
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
        deductibilityMutation.isPending ||
        transitionMutation.isPending;
    const canManageReviewWorkflow =
        session.user?.roles.some(
            (role) => role === "Department Manager" || role === "Finance Admin",
        ) ?? false;

    function handleOpenReview(report: ApprovalQueueReportRow): void {
        const firstLineItem = report.lineItems[0];
        if (firstLineItem === undefined) {
            return;
        }

        setActionError(null);
        setSelectedReportId(report.expenseReportId);

        if (
            canManageReviewWorkflow &&
            firstLineItem.currentStage === "Submitted"
        ) {
            transitionMutation.mutate({
                expenseReportId: report.expenseReportId,
                toStage: "Manager Approval",
                reason: "manager review started",
            });
        }
    }

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
                        onOpenReview={handleOpenReview}
                    />
                    {selectedReportId === null ||
                    selectedReportLineItems.length === 0 ? null : (
                        <ApprovalQueueReviewDialog
                            canManageReviewWorkflow={canManageReviewWorkflow}
                            isActionPending={isActionPending}
                            lineItems={selectedReportLineItems}
                            onAdvanceReport={(lineItem) =>
                                transitionMutation.mutate({
                                    expenseReportId: lineItem.expenseReportId,
                                    toStage: "AP Review",
                                    reason: "manager approved after flag review",
                                })
                            }
                            onClearFlag={(lineItem, sourceId) => {
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
                                    sourceId,
                                    reason: reason.trim(),
                                });
                            }}
                            onClose={() => setSelectedReportId(null)}
                            onReviewLineItem={(
                                lineItem,
                                sourceType,
                                sourceId,
                                action,
                            ) => {
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
                                    sourceId,
                                    sourceType,
                                    action,
                                    ...(reason === undefined ? {} : { reason }),
                                });
                            }}
                            onToggleDeductibility={(
                                lineItem,
                                sourceType,
                                sourceId,
                                deductible,
                            ) => {
                                deductibilityMutation.mutate({
                                    lineItem,
                                    sourceId,
                                    sourceType,
                                    deductible,
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
    onOpenReview: (report: ApprovalQueueReportRow) => void;
}): JSX.Element {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const reportRows = useMemo(
        () => groupApprovalQueueReports(lineItems),
        [lineItems],
    );
    const columns = useMemo<ColumnDef<ApprovalQueueReportRow>[]>(
        () => [
            {
                accessorKey: "employee",
                header: "Employee",
                cell: ({ row }) => (
                    <div className="case-queue-employee">
                        <span className="case-queue-employee__avatar">
                            {getEmployeeInitials(row.original.employee)}
                        </span>
                        <span>
                            <strong>
                                {getEmployeeDisplayName(row.original.employee)}
                            </strong>
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
                accessorKey: "totalAmount",
                header: "Total Amount",
                cell: ({ getValue }) =>
                    formatCurrency(
                        getValue<ApprovalQueueReportRow["totalAmount"]>(),
                    ),
                sortDescFirst: false,
                sortingFn: "basic",
            },
            {
                accessorKey: "totalMileage",
                header: "Mileage",
                cell: ({ getValue }) =>
                    formatMileageDistance(
                        getValue<ApprovalQueueReportRow["totalMileage"]>(),
                    ),
                sortDescFirst: false,
                sortingFn: "basic",
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
                    getValue<ApprovalQueueReportRow["flaggedLineItem"]>() ? (
                        <Badge tone="warning">Over $500</Badge>
                    ) : (
                        <Badge tone="success">Clear</Badge>
                    ),
            },
            {
                id: "actions",
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
        data: reportRows,
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
                                current[0]?.id === "totalAmount" &&
                                current[0].desc
                                    ? [{ id: "totalAmount", desc: false }]
                                    : [{ id: "totalAmount", desc: true }],
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
                aria-label="Approval Queue reports"
            >
                {reportRows.length === 0 ? (
                    <EmptyState
                        body="There are no reports waiting in the Approval Queue."
                        title="No reports waiting for review"
                    />
                ) : (
                    <div className="case-queue-table__frame">
                        <table aria-label="Approval Queue reports">
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
                                    <tr
                                        aria-label={[
                                            `Expense Report ${row.original.expenseReportId}`,
                                            getEmployeeDisplayName(
                                                row.original.employee,
                                            ),
                                            row.original.currentStage,
                                            formatCurrency(
                                                row.original.totalAmount,
                                            ),
                                        ].join(" ")}
                                        key={row.id}
                                    >
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
                            Showing {visibleRows.length} of {reportRows.length}{" "}
                            reports
                        </footer>
                    </div>
                )}
            </section>
        </>
    );
}

function ApprovalQueueReviewDialog({
    canManageReviewWorkflow,
    isActionPending,
    lineItems,
    onAdvanceReport,
    onClearFlag,
    onClose,
    onReviewLineItem,
    onSendBackReport,
    onToggleDeductibility,
}: {
    canManageReviewWorkflow: boolean;
    isActionPending: boolean;
    lineItems: ApprovalQueueLineItem[];
    onAdvanceReport: (lineItem: ApprovalQueueLineItem) => void;
    onClearFlag: (lineItem: ApprovalQueueLineItem, sourceId: string) => void;
    onClose: () => void;
    onReviewLineItem: (
        lineItem: ApprovalQueueLineItem,
        sourceType: "line_item" | "mileage",
        sourceId: string,
        action: LineItemReviewAction,
    ) => void;
    onSendBackReport: (lineItem: ApprovalQueueLineItem) => void;
    onToggleDeductibility: (
        lineItem: ApprovalQueueLineItem,
        sourceType: "line_item" | "mileage",
        sourceId: string,
        deductible: boolean,
    ) => void;
}): JSX.Element {
    const [activeTab, setActiveTab] = useState<ReportDetailTab>("line-items");
    const reportLineItem = lineItems[0];
    const {
        canAdvanceReport,
        canClearPolicyChecks,
        canEditDeductibility,
        canReviewLineItems,
        canSendBackReport,
    } = getReviewDialogPermissions(
        canManageReviewWorkflow,
        reportLineItem.currentStage,
    );
    const reviewRows = useMemo(
        () => buildApprovalQueueReviewRows(lineItems),
        [lineItems],
    );
    const policyChecks = useMemo(
        () =>
            reviewRows.flatMap((reviewRow) =>
                reviewRow.policyChecks.map((policyCheck) => ({
                    policyCheck,
                    reviewRow,
                })),
            ),
        [reviewRows],
    );
    const areAllReviewRowsReviewed = reviewRows.every(
        (reviewRow) => reviewRow.reviewAction !== null,
    );
    const lineItemTotal = lineItems.reduce(
        (total, lineItem) => total + lineItem.amount,
        0,
    );
    const mileageTotal = calculateReportMileageTotal(lineItems);

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
                                reviewRows.filter(
                                    (reviewRow) => reviewRow.flaggedLineItem,
                                ).length
                            }
                        </strong>
                    </span>
                    <span>
                        Total
                        <strong>{formatCurrency(lineItemTotal)}</strong>
                    </span>
                    <span>
                        Mileage
                        <strong>{formatMileageDistance(mileageTotal)}</strong>
                    </span>
                </div>
                <div
                    aria-label="Report detail tabs"
                    className="case-queue-dialog__tabs"
                    role="tablist"
                >
                    <button
                        aria-controls="report-line-items-panel"
                        aria-selected={activeTab === "line-items"}
                        id="report-line-items-tab"
                        role="tab"
                        type="button"
                        onClick={() => setActiveTab("line-items")}
                    >
                        Line Items
                    </button>
                    <button
                        aria-controls="report-policy-checks-panel"
                        aria-selected={activeTab === "policy-checks"}
                        id="report-policy-checks-tab"
                        role="tab"
                        type="button"
                        onClick={() => setActiveTab("policy-checks")}
                    >
                        Policy Checks
                    </button>
                </div>
                {activeTab === "line-items" ? (
                    <div
                        aria-labelledby="report-line-items-tab"
                        className="case-queue-dialog__table-wrap"
                        id="report-line-items-panel"
                        role="tabpanel"
                    >
                        <table aria-label="Report review line items">
                            <thead>
                                <tr>
                                    <th scope="col">Merchant</th>
                                    <th scope="col">Amount</th>
                                    <th scope="col">Mileage</th>
                                    <th scope="col">GL Code</th>
                                    <th scope="col">Flag</th>
                                    <th scope="col">Deductible</th>
                                    <th scope="col">Review</th>
                                    <th scope="col">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reviewRows.map((reviewRow) => (
                                    <tr key={reviewRow.id}>
                                        <td>{reviewRow.merchant}</td>
                                        <td>
                                            {formatCurrency(reviewRow.amount)}
                                        </td>
                                        <td>
                                            {formatMileageDistance(
                                                reviewRow.mileage,
                                            )}
                                        </td>
                                        <td>{reviewRow.glCode}</td>
                                        <td>
                                            {reviewRow.flaggedLineItem ? (
                                                <Badge tone="warning">
                                                    Over $500
                                                </Badge>
                                            ) : (
                                                <Badge tone="success">
                                                    Clear
                                                </Badge>
                                            )}
                                        </td>
                                        <td>
                                            <input
                                                aria-label={`Mark ${reviewRow.merchant} as deductible`}
                                                checked={reviewRow.deductible}
                                                disabled={
                                                    isActionPending ||
                                                    !canEditDeductibility
                                                }
                                                type="checkbox"
                                                onChange={(event) =>
                                                    onToggleDeductibility(
                                                        reviewRow.lineItem,
                                                        reviewRow.type,
                                                        reviewRow.id,
                                                        event.currentTarget
                                                            .checked,
                                                    )
                                                }
                                            />
                                        </td>
                                        <td>
                                            {getReviewActionLabel(
                                                reviewRow.reviewAction,
                                            )}
                                        </td>
                                        <td>
                                            <div className="case-queue-dialog__actions">
                                                <button
                                                    className="button button--secondary button--compact"
                                                    disabled={
                                                        isActionPending ||
                                                        !canReviewLineItems
                                                    }
                                                    type="button"
                                                    onClick={() =>
                                                        onReviewLineItem(
                                                            reviewRow.lineItem,
                                                            reviewRow.type,
                                                            reviewRow.id,
                                                            "approve",
                                                        )
                                                    }
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    className="button button--secondary button--compact"
                                                    disabled={
                                                        isActionPending ||
                                                        !canReviewLineItems
                                                    }
                                                    type="button"
                                                    onClick={() =>
                                                        onReviewLineItem(
                                                            reviewRow.lineItem,
                                                            reviewRow.type,
                                                            reviewRow.id,
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
                                                        !canClearPolicyChecks ||
                                                        !reviewRow.flaggedLineItem
                                                    }
                                                    type="button"
                                                    onClick={() =>
                                                        onClearFlag(
                                                            reviewRow.lineItem,
                                                            reviewRow.id,
                                                        )
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
                ) : (
                    <div
                        aria-labelledby="report-policy-checks-tab"
                        className="case-queue-dialog__table-wrap"
                        id="report-policy-checks-panel"
                        role="tabpanel"
                    >
                        {policyChecks.length === 0 ? (
                            <div
                                className="case-queue-dialog__empty-tab"
                                role="status"
                            >
                                No policy checks apply to this report.
                            </div>
                        ) : (
                            <table aria-label="Policy checks">
                                <thead>
                                    <tr>
                                        <th scope="col">Merchant</th>
                                        <th scope="col">Amount</th>
                                        <th scope="col">GL Code</th>
                                        <th scope="col">Check</th>
                                        <th scope="col">State</th>
                                        <th scope="col">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {policyChecks.map(
                                        ({ policyCheck, reviewRow }) => (
                                            <tr
                                                key={`${reviewRow.id}:${policyCheck.code}`}
                                            >
                                                <th scope="row">
                                                    {reviewRow.merchant}
                                                </th>
                                                <td>
                                                    {formatCurrency(
                                                        reviewRow.amount,
                                                    )}
                                                </td>
                                                <td>{reviewRow.glCode}</td>
                                                <td>{policyCheck.message}</td>
                                                <td>
                                                    {policyCheck.state ===
                                                    "uncleared" ? (
                                                        <Badge tone="warning">
                                                            Uncleared
                                                        </Badge>
                                                    ) : (
                                                        <Badge tone="success">
                                                            Cleared
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td>
                                                    <button
                                                        className="button button--secondary button--compact"
                                                        disabled={
                                                            isActionPending ||
                                                            !canClearPolicyChecks ||
                                                            policyCheck.state !==
                                                                "uncleared"
                                                        }
                                                        type="button"
                                                        onClick={() =>
                                                            onClearFlag(
                                                                reviewRow.lineItem,
                                                                reviewRow.id,
                                                            )
                                                        }
                                                    >
                                                        Clear flag
                                                    </button>
                                                </td>
                                            </tr>
                                        ),
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
                <footer className="case-queue-dialog__footer">
                    <button
                        className="button button--secondary button--compact"
                        disabled={
                            isActionPending ||
                            !canAdvanceReport ||
                            !reportLineItem.canAdvance ||
                            !areAllReviewRowsReviewed
                        }
                        type="button"
                        onClick={() => onAdvanceReport(reportLineItem)}
                    >
                        Advance
                    </button>
                    {canSendBackReport ? (
                        <button
                            className="button button--danger button--compact"
                            disabled={
                                isActionPending || !areAllReviewRowsReviewed
                            }
                            type="button"
                            onClick={() => onSendBackReport(reportLineItem)}
                        >
                            Reject / Send back to Drafted
                        </button>
                    ) : null}
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

function formatMileageDistance(mileageDistance: number): string {
    if (mileageDistance === 0) {
        return "-";
    }

    return `${new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: mileageDistance % 1 === 0 ? 0 : 2,
    }).format(mileageDistance)} miles`;
}

function buildApprovalQueueReviewRows(
    lineItems: ApprovalQueueLineItem[],
): ApprovalQueueReviewRow[] {
    const mileageEntryIds = new Set<string>();
    const rows: ApprovalQueueReviewRow[] = lineItems.map((lineItem) => ({
        type: lineItem.sourceType,
        id: lineItem.id,
        merchant: lineItem.merchant,
        amount: lineItem.amount,
        mileage:
            lineItem.sourceType === "mileage" ? lineItem.reportTotalMileage : 0,
        glCode: lineItem.glCode,
        flaggedLineItem: lineItem.flaggedLineItem,
        policyChecks: lineItem.policyChecks,
        reviewAction: lineItem.reviewAction,
        deductible: lineItem.deductible,
        lineItem,
    }));

    for (const lineItem of lineItems) {
        for (const mileageEntry of lineItem.mileageEntries) {
            if (mileageEntryIds.has(mileageEntry.id)) {
                continue;
            }

            mileageEntryIds.add(mileageEntry.id);
            rows.push({
                type: "mileage",
                id: mileageEntry.id,
                merchant: mileageEntry.route,
                amount: mileageEntry.amount,
                mileage: mileageEntry.distance,
                glCode: mileageEntry.glCode,
                flaggedLineItem: mileageEntry.flaggedLineItem,
                policyChecks: mileageEntry.policyChecks,
                reviewAction: mileageEntry.reviewAction,
                deductible: mileageEntry.deductible,
                lineItem,
            });
        }
    }

    return rows;
}

function groupApprovalQueueReports(
    lineItems: ApprovalQueueLineItem[],
): ApprovalQueueReportRow[] {
    const reportsById = new Map<string, ApprovalQueueReportRow>();

    for (const lineItem of lineItems) {
        const existingReport = reportsById.get(lineItem.expenseReportId);
        if (existingReport === undefined) {
            reportsById.set(lineItem.expenseReportId, {
                expenseReportId: lineItem.expenseReportId,
                employee: lineItem.employee,
                currentStage: lineItem.currentStage,
                flaggedLineItem: hasOpenSourceFlag(lineItem),
                totalAmount: lineItem.amount,
                totalMileage: calculateReportMileageTotal([lineItem]),
                lineItems: [lineItem],
            });
            continue;
        }

        existingReport.flaggedLineItem =
            existingReport.flaggedLineItem || hasOpenSourceFlag(lineItem);
        existingReport.totalAmount += lineItem.amount;
        existingReport.lineItems.push(lineItem);
        existingReport.totalMileage = calculateReportMileageTotal(
            existingReport.lineItems,
        );
    }

    return [...reportsById.values()];
}

function hasOpenSourceFlag(lineItem: ApprovalQueueLineItem): boolean {
    return (
        lineItem.flaggedLineItem ||
        lineItem.mileageEntries.some((entry) => entry.flaggedLineItem)
    );
}

function calculateReportMileageTotal(
    lineItems: ApprovalQueueLineItem[],
): number {
    const mileageById = new Map<string, number>();
    const reportMileageById = new Map<string, number>();
    for (const lineItem of lineItems) {
        if (lineItem.sourceType === "mileage") {
            mileageById.set(lineItem.id, lineItem.reportTotalMileage);
        } else if (lineItem.reportTotalMileage > 0) {
            reportMileageById.set(
                lineItem.expenseReportId,
                lineItem.reportTotalMileage,
            );
        }

        for (const mileageEntry of lineItem.mileageEntries) {
            mileageById.set(mileageEntry.id, mileageEntry.distance);
        }
    }

    if (mileageById.size === 0) {
        return [...reportMileageById.values()].reduce(
            (total, miles) => total + miles,
            0,
        );
    }

    return [...mileageById.values()].reduce((total, miles) => total + miles, 0);
}

function getEmployeeDisplayName(employee: string): string {
    return `Employee ${employee.slice(-4)}`;
}

function getEmployeeInitials(employee: string): string {
    return employee.slice(-2).toUpperCase();
}

function getReportDisplayId(expenseReportId: string): string {
    return expenseReportId.slice(0, 8);
}

function exportApprovalQueueCsv(reports: ApprovalQueueReportRow[]): void {
    const header = [
        "Employee",
        "Submission",
        "Total Amount",
        "Mileage",
        "Stage",
        "Flag",
        "Action",
    ];
    const rows = reports.map((report) => [
        getEmployeeDisplayName(report.employee),
        getReportDisplayId(report.expenseReportId),
        formatCurrency(report.totalAmount),
        formatMileageDistance(report.totalMileage),
        report.currentStage,
        report.flaggedLineItem ? "Amount > $500" : "Clear",
        "Review",
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
            current.map((lineItem) => {
                if (lineItem.id === updatedLineItem.id) {
                    return {
                        ...updatedLineItem,
                        mileageEntries:
                            updatedLineItem.mileageEntries.length > 0
                                ? updatedLineItem.mileageEntries
                                : lineItem.mileageEntries,
                    };
                }

                if (
                    lineItem.expenseReportId !== updatedLineItem.expenseReportId
                ) {
                    return lineItem;
                }

                return {
                    ...lineItem,
                    mileageEntries: lineItem.mileageEntries.map((entry) =>
                        entry.id === updatedLineItem.id
                            ? {
                                  ...entry,
                                  flaggedLineItem:
                                      updatedLineItem.flaggedLineItem,
                                  policyChecks: updatedLineItem.policyChecks,
                                  reviewAction: updatedLineItem.reviewAction,
                                  deductible: updatedLineItem.deductible,
                              }
                            : entry,
                    ),
                };
            }),
        ),
    );
}

function markPolicyChecksCleared(
    policyChecks: z.infer<typeof policyCheckSchema>[],
): z.infer<typeof policyCheckSchema>[] {
    return policyChecks.map((policyCheck) => ({
        ...policyCheck,
        state: "cleared",
    }));
}

function updateQueueReportStage(
    queryClient: QueryClient,
    report: z.infer<typeof expenseReportTransitionResponseSchema>,
): void {
    setApprovalQueueData(queryClient, (current = []) =>
        updateQueueReportStageInLineItems(
            current,
            report.id,
            report.currentStage,
        ),
    );
}

function updateQueueReportStageInLineItems(
    lineItems: ApprovalQueueLineItem[],
    expenseReportId: string,
    currentStage: ExpenseReportStage,
): ApprovalQueueLineItem[] {
    if (currentStage === "Drafted") {
        return lineItems.filter(
            (lineItem) => lineItem.expenseReportId !== expenseReportId,
        );
    }

    return recalculateAdvanceEligibility(
        lineItems.map((lineItem) =>
            lineItem.expenseReportId === expenseReportId
                ? {
                      ...lineItem,
                      currentStage,
                  }
                : lineItem,
        ),
    );
}

function recalculateAdvanceEligibility(
    lineItems: ApprovalQueueLineItem[],
): ApprovalQueueLineItem[] {
    const openFlagCounts = new Map<string, number>();
    const unreviewedLineItemCounts = new Map<string, number>();
    for (const lineItem of lineItems) {
        if (lineItem.flaggedLineItem) {
            openFlagCounts.set(
                lineItem.expenseReportId,
                (openFlagCounts.get(lineItem.expenseReportId) ?? 0) + 1,
            );
        }

        if (lineItem.reviewAction === null) {
            unreviewedLineItemCounts.set(
                lineItem.expenseReportId,
                (unreviewedLineItemCounts.get(lineItem.expenseReportId) ?? 0) +
                    1,
            );
        }

        for (const mileageEntry of lineItem.mileageEntries) {
            if (mileageEntry.flaggedLineItem) {
                openFlagCounts.set(
                    lineItem.expenseReportId,
                    (openFlagCounts.get(lineItem.expenseReportId) ?? 0) + 1,
                );
            }

            if (mileageEntry.reviewAction === null) {
                unreviewedLineItemCounts.set(
                    lineItem.expenseReportId,
                    (unreviewedLineItemCounts.get(lineItem.expenseReportId) ??
                        0) + 1,
                );
            }
        }
    }

    return lineItems.map((lineItem) => ({
        ...lineItem,
        canAdvance:
            lineItem.currentStage === "Manager Approval" &&
            (openFlagCounts.get(lineItem.expenseReportId) ?? 0) === 0 &&
            (unreviewedLineItemCounts.get(lineItem.expenseReportId) ?? 0) === 0,
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
