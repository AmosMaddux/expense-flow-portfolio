import { z } from "zod";

import { Badge, EmptyState, ErrorState, LoadingSkeleton } from "../components";
import { useExpenseFlowQuery } from "../query/queryClient";

const auditLogActorSchema = z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
});

const auditLogEntitySchema = z.enum(["gl_mapping", "user"]);

const auditLogActionSchema = z.enum([
    "gl_mapping_updated",
    "user_invited",
    "user_role_changed",
    "user_status_changed",
]);

const auditLogEventSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    actor: auditLogActorSchema,
    entityType: auditLogEntitySchema,
    entityId: z.uuid(),
    action: auditLogActionSchema,
    occurredAt: z.iso.datetime({ offset: true }),
});

const auditLogEventListSchema = z.object({
    events: z.array(auditLogEventSchema),
});

export type AuditLogAction = z.infer<typeof auditLogActionSchema>;
export type AuditLogEvent = z.infer<typeof auditLogEventSchema>;

const actionLabels: Record<AuditLogAction, string> = {
    gl_mapping_updated: "GL mapping updated",
    user_invited: "User invited",
    user_role_changed: "User role changed",
    user_status_changed: "User status changed",
};

/**
 * Fetches the most recent cross-tenant administrative audit events for the
 * Platform Admin workspace. Returns actor, action, and entity metadata only
 * — never a tenant's case content.
 */
export function useAuditLogEvents() {
    return useExpenseFlowQuery<AuditLogEvent[]>({
        input: "/v1/platform-admin/audit-log",
        keyParts: ["platform-admin", "audit-log"],
        parseResponse: async (response) =>
            auditLogEventListSchema.parse(await response.json()).events,
        staleTime: 15_000,
    });
}

/**
 * Renders the Platform Admin Audit Log screen: a read-only list of
 * administrative events across every tenant. There is no control here to
 * edit, replay, or open a tenant's underlying case data.
 */
export function AuditLogScreen(): JSX.Element {
    const query = useAuditLogEvents();
    const events = query.data ?? [];

    return (
        <section className="audit-log" aria-labelledby="audit-log-heading">
            <header className="audit-log__header">
                <div>
                    <h2 id="audit-log-heading">Audit Log</h2>
                    <p className="audit-log__subtitle">
                        Administrative events across every tenant. Actor,
                        action, and timestamp only — tenant case content is
                        never shown here.
                    </p>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Audit Log" rows={5} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getAuditLogErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load Audit Log"
                />
            ) : events.length === 0 ? (
                <EmptyState
                    body="No administrative activity has been recorded yet."
                    title="No audit events found"
                />
            ) : (
                <AuditLogTable events={events} />
            )}
        </section>
    );
}

function AuditLogTable({
    events,
}: {
    events: AuditLogEvent[];
}): JSX.Element {
    return (
        <div className="audit-log-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Timestamp</th>
                        <th scope="col">Actor</th>
                        <th scope="col">Action</th>
                        <th scope="col">Entity</th>
                        <th scope="col">Tenant</th>
                    </tr>
                </thead>
                <tbody>
                    {events.map((event) => (
                        <tr key={event.id}>
                            <th scope="row">
                                {formatOccurredAt(event.occurredAt)}
                            </th>
                            <td>{formatActor(event.actor)}</td>
                            <td>
                                <Badge tone="info">
                                    {actionLabels[event.action]}
                                </Badge>
                            </td>
                            <td>{formatEntityType(event.entityType)}</td>
                            <td>{event.tenantId}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function formatActor(actor: AuditLogEvent["actor"]): string {
    return actor.displayName ?? actor.email ?? actor.id;
}

function formatEntityType(entityType: AuditLogEvent["entityType"]): string {
    return entityType === "gl_mapping" ? "GL mapping" : "User";
}

function formatOccurredAt(occurredAt: string): string {
    return new Date(occurredAt).toLocaleString();
}

function getAuditLogErrorMessage(error: Error | null): string {
    return (
        error?.message ??
        "Audit Log data could not be loaded. Retry the request or sign in again if the problem continues."
    );
}
