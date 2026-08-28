import { z } from "zod";

import { roleNames } from "../navigation";
import { Badge, EmptyState, ErrorState, LoadingSkeleton } from "../components";
import { useExpenseFlowQuery } from "../query/queryClient";

const roleSchema = z.enum(roleNames);

const screenSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
});

const roleMatrixEntrySchema = z.object({
    role: roleSchema,
    screens: z.record(z.string(), z.boolean()),
});

const rolePermissionMatrixSchema = z.object({
    screens: z.array(screenSchema),
    roles: z.array(roleMatrixEntrySchema),
});

export type RolePermissionMatrix = z.infer<typeof rolePermissionMatrixSchema>;

/**
 * Fetches the read-only role-to-screen-access matrix for the Platform Admin
 * workspace. This is a platform-level read, not scoped to one tenant.
 */
export function useRolePermissionMatrix() {
    return useExpenseFlowQuery<RolePermissionMatrix>({
        input: "/v1/platform-admin/roles-permissions",
        keyParts: ["platform-admin", "roles-permissions"],
        parseResponse: async (response) =>
            rolePermissionMatrixSchema.parse(await response.json()),
        staleTime: 60_000,
    });
}

/**
 * Renders the Platform Admin Roles & Permissions screen: a read-only matrix
 * of which roles can reach which ExpenseFlow screens. There is no control
 * here to edit a role, a permission, or any tenant's case data.
 */
export function RolesPermissionsScreen(): JSX.Element {
    const query = useRolePermissionMatrix();
    const matrix = query.data;

    return (
        <section
            className="roles-permissions"
            aria-labelledby="roles-permissions-heading"
        >
            <header className="roles-permissions__header">
                <div>
                    <h2 id="roles-permissions-heading">
                        Roles &amp; Permissions
                    </h2>
                    <p className="roles-permissions__subtitle">
                        Read-only. Screen access is granted per role and
                        cannot be changed from this screen.
                    </p>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton
                    label="Loading Roles & Permissions"
                    rows={5}
                />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getRolePermissionMatrixErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load Roles & Permissions"
                />
            ) : matrix === undefined || matrix.screens.length === 0 ? (
                <EmptyState
                    body="No screens are configured for this platform."
                    title="No screens found"
                />
            ) : (
                <RolePermissionMatrixTable matrix={matrix} />
            )}
        </section>
    );
}

function RolePermissionMatrixTable({
    matrix,
}: {
    matrix: RolePermissionMatrix;
}): JSX.Element {
    return (
        <div className="roles-permissions-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Screen</th>
                        {matrix.roles.map((roleEntry) => (
                            <th key={roleEntry.role} scope="col">
                                {roleEntry.role}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {matrix.screens.map((screen) => (
                        <tr key={screen.key}>
                            <th scope="row">{screen.label}</th>
                            {matrix.roles.map((roleEntry) => {
                                const isAllowed =
                                    roleEntry.screens[screen.key] ?? false;

                                return (
                                    <td key={roleEntry.role}>
                                        <Badge
                                            tone={
                                                isAllowed
                                                    ? "success"
                                                    : "neutral"
                                            }
                                        >
                                            {isAllowed
                                                ? "Allowed"
                                                : "No access"}
                                        </Badge>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function getRolePermissionMatrixErrorMessage(error: Error | null): string {
    return (
        error?.message ??
        "Roles & Permissions data could not be loaded. Retry the request or sign in again if the problem continues."
    );
}
