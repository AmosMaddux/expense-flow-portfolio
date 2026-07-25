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
import { useMemo, useState } from "react";
import { z } from "zod";

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
    merchant: z.string().min(1),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    currentStage: z.enum(EXPENSE_REPORT_STAGES),
    flaggedLineItem: z.boolean(),
});

export const approvalQueueLineItemListSchema = z.array(
    approvalQueueLineItemSchema,
);

export type ApprovalQueueLineItem = z.infer<typeof approvalQueueLineItemSchema>;

type FlagFilter = "all" | "flagged" | "clear";

/**
 * Fetches authenticated Approval Queue line items for the current tenant.
 */
export function useApprovalQueueLineItems() {
    return useExpenseFlowQuery<ApprovalQueueLineItem[]>({
        input: "/v1/case-queue/line-items",
        keyParts: ["case-queue", "line-items"],
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
                <ApprovalQueueLineItemTable lineItems={query.data ?? []} />
            )}
        </section>
    );
}

function ApprovalQueueLineItemTable({
    lineItems,
}: {
    lineItems: ApprovalQueueLineItem[];
}): JSX.Element {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const columns = useMemo<ColumnDef<ApprovalQueueLineItem>[]>(
        () => [
            {
                accessorKey: "merchant",
                header: "Merchant",
                cell: ({ getValue }) => (
                    <strong>
                        {getValue<ApprovalQueueLineItem["merchant"]>()}
                    </strong>
                ),
            },
            {
                accessorKey: "amount",
                header: "Amount",
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
        ],
        [],
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
    const visibleRows = table.getRowModel().rows;

    return (
        <>
            <div
                className="case-queue-toolbar"
                aria-label="Approval Queue filters"
            >
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
                        <option value="all">All stages</option>
                        {EXPENSE_REPORT_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                                {stage}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Flag</span>
                    <select
                        aria-label="Filter by flag status"
                        value={flagFilter}
                        onChange={(event) =>
                            table
                                .getColumn("flaggedLineItem")
                                ?.setFilterValue(
                                    event.target.value === "all"
                                        ? undefined
                                        : event.target.value,
                                )
                        }
                    >
                        <option value="all">All line items</option>
                        <option value="flagged">Over $500</option>
                        <option value="clear">Clear</option>
                    </select>
                </label>
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
                        <table>
                            <caption>
                                Tenant-scoped Approval Queue line items
                            </caption>
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

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        currency: "USD",
        style: "currency",
    }).format(amount);
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
