import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { useSession } from "../auth";
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
} from "../components";
import {
    QueryRequestError,
    createTenantQueryKey,
    useExpenseFlowQuery,
} from "../query/queryClient";

const roleSchema = z.enum([
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]);

const statusSchema = z.enum(["invited", "active", "deactivated"]);

const teamUserSchema = z.object({
    id: z.string().uuid(),
    email: z.string().min(1),
    displayName: z.string().nullable(),
    status: statusSchema,
    roles: z.array(roleSchema),
    createdAt: z.iso.datetime({ offset: true }),
});

const teamUsersListSchema = z.object({
    users: z.array(teamUserSchema),
});

export type TeamUserRole = z.infer<typeof roleSchema>;
export type TeamUserStatus = z.infer<typeof statusSchema>;
export type TeamUser = z.infer<typeof teamUserSchema>;

const assignableRoles: TeamUserRole[] = [
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
];

const emptyInviteForm = {
    email: "",
    displayName: "",
    role: "Employee" as TeamUserRole,
};

/**
 * Fetches every tenant-scoped team member for the Finance Admin workspace.
 */
export function useTeamUsers() {
    return useExpenseFlowQuery<TeamUser[]>({
        input: "/v1/users",
        keyParts: ["users"],
        parseResponse: async (response) =>
            teamUsersListSchema.parse(await response.json()).users,
        staleTime: 15_000,
    });
}

/**
 * Renders the Finance Admin Team & Users screen: lists tenant users with
 * role and status, and allows inviting new users and managing existing ones.
 */
const allRolesFilter = "all";
const allStatusesFilter = "all";

export function TeamAndUsersScreen(): JSX.Element {
    const session = useSession();
    const queryClient = useQueryClient();
    const query = useTeamUsers();
    const [inviteForm, setInviteForm] = useState(emptyInviteForm);
    const [searchTerm, setSearchTerm] = useState("");
    const [roleFilter, setRoleFilter] = useState<TeamUserRole | "all">(
        allRolesFilter,
    );
    const [statusFilter, setStatusFilter] = useState<TeamUserStatus | "all">(
        allStatusesFilter,
    );
    const users = query.data ?? [];
    const filteredUsers = filterTeamUsers(users, {
        roleFilter,
        searchTerm,
        statusFilter,
    });

    const invalidateUsers = async () => {
        if (session.user !== null) {
            await queryClient.invalidateQueries({
                queryKey: createTenantQueryKey(session.user, ["users"]),
            });
        }
    };

    const inviteMutation = useMutation({
        mutationFn: async (values: typeof emptyInviteForm) => {
            const response = await session.authenticatedFetch(
                "/v1/users/invite",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(values),
                },
            );

            if (!response.ok) {
                throw await createMutationRequestError(response);
            }

            return teamUserSchema.parse(await response.json());
        },
        onSuccess: async () => {
            setInviteForm(emptyInviteForm);
            await invalidateUsers();
        },
    });

    const roleMutation = useMutation({
        mutationFn: async ({
            userId,
            role,
        }: {
            userId: string;
            role: TeamUserRole;
        }) => {
            const response = await session.authenticatedFetch(
                `/v1/users/${userId}/role`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role }),
                },
            );

            if (!response.ok) {
                throw await createMutationRequestError(response);
            }

            return teamUserSchema.parse(await response.json());
        },
        onSuccess: invalidateUsers,
    });

    const statusMutation = useMutation({
        mutationFn: async ({
            userId,
            status,
        }: {
            userId: string;
            status: "active" | "deactivated";
        }) => {
            const response = await session.authenticatedFetch(
                `/v1/users/${userId}/status`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status }),
                },
            );

            if (!response.ok) {
                throw await createMutationRequestError(response);
            }

            return teamUserSchema.parse(await response.json());
        },
        onSuccess: invalidateUsers,
    });

    const mutationError =
        inviteMutation.error ?? roleMutation.error ?? statusMutation.error;

    return (
        <section className="team-users" aria-labelledby="team-users-heading">
            <header className="team-users__header">
                <div>
                    <h2 id="team-users-heading">Team &amp; Users</h2>
                </div>
            </header>

            <form
                className="team-users-invite"
                aria-label="Invite a user"
                onSubmit={(event) => {
                    event.preventDefault();
                    inviteMutation.mutate(inviteForm);
                }}
            >
                <h3>Invite a user</h3>
                <div className="team-users-invite__fields">
                    <label>
                        Email
                        <input
                            type="email"
                            required
                            value={inviteForm.email}
                            onChange={(event) =>
                                setInviteForm((current) => ({
                                    ...current,
                                    email: event.target.value,
                                }))
                            }
                        />
                    </label>
                    <label>
                        Name
                        <input
                            type="text"
                            required
                            value={inviteForm.displayName}
                            onChange={(event) =>
                                setInviteForm((current) => ({
                                    ...current,
                                    displayName: event.target.value,
                                }))
                            }
                        />
                    </label>
                    <label>
                        Role
                        <select
                            value={inviteForm.role}
                            onChange={(event) =>
                                setInviteForm((current) => ({
                                    ...current,
                                    role: event.target.value as TeamUserRole,
                                }))
                            }
                        >
                            {assignableRoles.map((role) => (
                                <option key={role} value={role}>
                                    {role}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Button
                        disabled={inviteMutation.isPending}
                        type="submit"
                        variant="primary"
                    >
                        {inviteMutation.isPending ? "Inviting..." : "Invite"}
                    </Button>
                </div>
            </form>

            {query.isPending ? (
                <LoadingSkeleton label="Loading Team & Users" rows={5} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getTeamUsersErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load Team & Users"
                />
            ) : users.length === 0 ? (
                <EmptyState
                    body="No users are configured for this tenant."
                    title="No users found"
                />
            ) : (
                <>
                    <div
                        className="team-users-filters"
                        role="search"
                        aria-label="Filter team members"
                    >
                        <label>
                            Search
                            <input
                                type="search"
                                placeholder="Search by name or email"
                                value={searchTerm}
                                onChange={(event) =>
                                    setSearchTerm(event.target.value)
                                }
                            />
                        </label>
                        <label>
                            Filter by role
                            <select
                                value={roleFilter}
                                onChange={(event) =>
                                    setRoleFilter(
                                        event.target.value as
                                            | TeamUserRole
                                            | "all",
                                    )
                                }
                            >
                                <option value={allRolesFilter}>
                                    All roles
                                </option>
                                {assignableRoles.map((role) => (
                                    <option key={role} value={role}>
                                        {role}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Filter by status
                            <select
                                value={statusFilter}
                                onChange={(event) =>
                                    setStatusFilter(
                                        event.target.value as
                                            | TeamUserStatus
                                            | "all",
                                    )
                                }
                            >
                                <option value={allStatusesFilter}>
                                    All statuses
                                </option>
                                <option value="invited">Invited</option>
                                <option value="active">Active</option>
                                <option value="deactivated">
                                    Deactivated
                                </option>
                            </select>
                        </label>
                    </div>

                    {filteredUsers.length === 0 ? (
                        <EmptyState
                            body="No users match the current search or filters."
                            title="No matching users"
                        />
                    ) : (
                        <TeamUsersTable
                            isSaving={
                                roleMutation.isPending ||
                                statusMutation.isPending
                            }
                            onChangeRole={(userId, role) =>
                                roleMutation.mutate({ userId, role })
                            }
                            onChangeStatus={(userId, status) =>
                                statusMutation.mutate({ userId, status })
                            }
                            users={filteredUsers}
                        />
                    )}
                </>
            )}
            {mutationError ? (
                <p className="team-users__error" role="alert">
                    {getTeamUsersErrorMessage(mutationError)}
                </p>
            ) : null}
        </section>
    );
}

function TeamUsersTable({
    isSaving,
    onChangeRole,
    onChangeStatus,
    users,
}: {
    isSaving: boolean;
    onChangeRole: (userId: string, role: TeamUserRole) => void;
    onChangeStatus: (
        userId: string,
        status: "active" | "deactivated",
    ) => void;
    users: TeamUser[];
}): JSX.Element {
    return (
        <div className="team-users-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Role</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((teamUser) => {
                        const currentRole = teamUser.roles[0] ?? "Employee";

                        return (
                            <tr key={teamUser.id}>
                                <th scope="row">
                                    {teamUser.displayName ?? teamUser.email}
                                </th>
                                <td>{teamUser.email}</td>
                                <td>
                                    <select
                                        aria-label={`${teamUser.email} role`}
                                        disabled={isSaving}
                                        onChange={(event) =>
                                            onChangeRole(
                                                teamUser.id,
                                                event.target
                                                    .value as TeamUserRole,
                                            )
                                        }
                                        value={currentRole}
                                    >
                                        {assignableRoles.map((role) => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>
                                    <Badge
                                        tone={statusTone(teamUser.status)}
                                    >
                                        {statusLabel(teamUser.status)}
                                    </Badge>
                                </td>
                                <td>
                                    {teamUser.status === "deactivated" ? (
                                        <Button
                                            disabled={isSaving}
                                            onClick={() =>
                                                onChangeStatus(
                                                    teamUser.id,
                                                    "active",
                                                )
                                            }
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Reactivate
                                        </Button>
                                    ) : (
                                        <Button
                                            disabled={isSaving}
                                            onClick={() =>
                                                onChangeStatus(
                                                    teamUser.id,
                                                    "deactivated",
                                                )
                                            }
                                            size="sm"
                                            variant="danger"
                                        >
                                            Deactivate
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function filterTeamUsers(
    users: TeamUser[],
    filters: {
        roleFilter: TeamUserRole | "all";
        searchTerm: string;
        statusFilter: TeamUserStatus | "all";
    },
): TeamUser[] {
    const normalizedSearchTerm = filters.searchTerm.trim().toLowerCase();

    return users.filter((teamUser) => {
        if (
            filters.roleFilter !== allRolesFilter &&
            !teamUser.roles.includes(filters.roleFilter)
        ) {
            return false;
        }

        if (
            filters.statusFilter !== allStatusesFilter &&
            teamUser.status !== filters.statusFilter
        ) {
            return false;
        }

        if (normalizedSearchTerm.length === 0) {
            return true;
        }

        return (
            (teamUser.displayName?.toLowerCase().includes(
                normalizedSearchTerm,
            ) ??
                false) ||
            teamUser.email.toLowerCase().includes(normalizedSearchTerm)
        );
    });
}

function statusTone(
    status: TeamUserStatus,
): "success" | "warning" | "neutral" {
    if (status === "active") {
        return "success";
    }

    if (status === "invited") {
        return "warning";
    }

    return "neutral";
}

function statusLabel(status: TeamUserStatus): string {
    if (status === "invited") {
        return "Invited";
    }

    if (status === "active") {
        return "Active";
    }

    return "Deactivated";
}

async function createMutationRequestError(
    response: Response,
): Promise<QueryRequestError> {
    const body: unknown = await response.json().catch(() => undefined);
    const detail =
        body !== null &&
        typeof body === "object" &&
        "detail" in body &&
        typeof body.detail === "string"
            ? body.detail
            : response.statusText;

    return new QueryRequestError(response.status, detail, body);
}

function getTeamUsersErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "Team & Users data could not be loaded or saved. Retry the request or sign in again if the problem continues.";
}
