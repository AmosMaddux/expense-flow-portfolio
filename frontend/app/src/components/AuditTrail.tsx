import type { UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";
import { EmptyState, ErrorState, LoadingSkeleton } from "./StateViews";
import { EXPENSE_REPORT_STAGES } from "./StageStepper";

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

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export type AuditTrailActionFormat = "raw" | "title";

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

export type AuditTrailProps = {
    actionFormat?: AuditTrailActionFormat;
    query: UseQueryResult<AuditEntry[], Error>;
};

/**
 * Renders the shared Audit Trail list used across the Expense Reports,
 * All Transactions, and Approval Queue review dialogs.
 */
export function AuditTrail({
    actionFormat = "title",
    query,
}: AuditTrailProps): JSX.Element {
    if (query.isPending) {
        return <LoadingSkeleton label="Loading Audit Trail" rows={3} />;
    }

    if (query.isError) {
        return (
            <ErrorState
                isRetrying={query.isFetching}
                message={getAuditTrailErrorMessage(query.error)}
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
                        {formatAuditTimestamp(entry.createdAt)}
                    </time>
                    <strong>
                        {formatAuditAction(entry.action, actionFormat)}
                    </strong>
                    <span>
                        {entry.stageBeforeAction} to{" "}
                        {entry.stageAfterProposedAction}
                    </span>
                    <small>Actor {formatAuditActor(entry.actorId)}</small>
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

function formatAuditTimestamp(date: string): string {
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        timeZone: "UTC",
        year: "numeric",
    }).format(new Date(date));
}

function formatAuditAction(
    action: string,
    format: AuditTrailActionFormat,
): string {
    if (format === "raw") {
        return action;
    }

    return action
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatAuditActor(actorId: string): string {
    return actorId.slice(0, 8).toUpperCase();
}

function getAuditTrailErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The report detail could not be loaded. Please retry.";
}
