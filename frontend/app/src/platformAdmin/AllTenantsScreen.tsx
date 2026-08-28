import { z } from "zod";

import { EmptyState, ErrorState, LoadingSkeleton } from "../components";
import { useExpenseFlowQuery } from "../query/queryClient";

const tenantSummarySchema = z.object({
    tenantId: z.uuid(),
    userCount: z.number().int().nonnegative(),
    activeUserCount: z.number().int().nonnegative(),
    invitedUserCount: z.number().int().nonnegative(),
    deactivatedUserCount: z.number().int().nonnegative(),
});

const tenantSummaryListSchema = z.object({
    tenants: z.array(tenantSummarySchema),
});

export type TenantSummary = z.infer<typeof tenantSummarySchema>;

/**
 * Fetches every tenant's user-count summary for the Platform Admin
 * workspace. This deliberately crosses tenant boundaries — it is the one
 * read a Platform Admin needs to administer the platform without
 * impersonating a tenant — and returns aggregate counts only.
 */
export function useTenantSummaries() {
    return useExpenseFlowQuery<TenantSummary[]>({
        input: "/v1/platform-admin/tenants",
        keyParts: ["platform-admin", "tenants"],
        parseResponse: async (response) =>
            tenantSummaryListSchema.parse(await response.json()).tenants,
        staleTime: 30_000,
    });
}

/**
 * Renders the Platform Admin All Tenants & Users screen: lists every tenant
 * with its user counts. There is no control here to open a tenant's case
 * data, view individual users, or act on a tenant's behalf.
 */
export function AllTenantsScreen(): JSX.Element {
    const query = useTenantSummaries();
    const tenants = query.data ?? [];

    return (
        <section
            className="all-tenants"
            aria-labelledby="all-tenants-heading"
        >
            <header className="all-tenants__header">
                <div>
                    <h2 id="all-tenants-heading">All Tenants &amp; Users</h2>
                    <p className="all-tenants__subtitle">
                        Aggregate user counts only. Tenant case data cannot
                        be opened from this screen.
                    </p>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading All Tenants & Users" rows={5} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getTenantSummariesErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load All Tenants & Users"
                />
            ) : tenants.length === 0 ? (
                <EmptyState
                    body="No tenants are configured for this platform."
                    title="No tenants found"
                />
            ) : (
                <TenantSummaryTable tenants={tenants} />
            )}
        </section>
    );
}

function TenantSummaryTable({
    tenants,
}: {
    tenants: TenantSummary[];
}): JSX.Element {
    return (
        <div className="all-tenants-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Tenant</th>
                        <th scope="col">Total users</th>
                        <th scope="col">Active</th>
                        <th scope="col">Invited</th>
                        <th scope="col">Deactivated</th>
                    </tr>
                </thead>
                <tbody>
                    {tenants.map((tenant) => (
                        <tr key={tenant.tenantId}>
                            <th scope="row">{tenant.tenantId}</th>
                            <td>{tenant.userCount}</td>
                            <td>{tenant.activeUserCount}</td>
                            <td>{tenant.invitedUserCount}</td>
                            <td>{tenant.deactivatedUserCount}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function getTenantSummariesErrorMessage(error: Error | null): string {
    return (
        error?.message ??
        "All Tenants & Users data could not be loaded. Retry the request or sign in again if the problem continues."
    );
}
