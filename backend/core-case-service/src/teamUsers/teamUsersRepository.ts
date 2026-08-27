import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import {
    referenceDataAuditEntry,
    role,
    roleValues,
    user,
    type RoleName,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError } from "../errors/problem-json.js";
import type { TeamUserResponse } from "./teamUsersDto.js";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type PostgresError = {
    cause?: unknown;
    code?: string;
    constraint?: string;
};

const uniqueViolationCode = "23505";
const userTenantEmailConstraint = "user_tenant_email_unique_idx";

/**
 * Reads every tenant-scoped team member for the Finance Admin workspace.
 */
export async function readTeamUsers(
    tenantId: string,
    database: Database = db,
): Promise<TeamUserResponse[]> {
    const [userRows, roleRows] = await Promise.all([
        database
            .select({
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                status: user.status,
                createdAt: user.createdAt,
            })
            .from(user)
            .where(eq(user.tenantId, tenantId))
            .orderBy(asc(user.email)),
        database
            .select({ userId: role.userId, name: role.name })
            .from(role)
            .where(eq(role.tenantId, tenantId)),
    ]);

    const rolesByUserId = groupRolesByUserId(roleRows);

    return userRows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        status: parseUserStatus(row.status),
        roles: rolesByUserId.get(row.id) ?? [],
        createdAt: row.createdAt.toISOString(),
    }));
}

/**
 * Invites a new tenant user with a single assigned role and appends a reference audit entry.
 */
export async function inviteTeamUser(
    input: {
        actorId: string;
        displayName: string;
        email: string;
        role: RoleName;
        tenantId: string;
    },
    database: Database = db,
): Promise<TeamUserResponse> {
    return database.transaction(async (transaction) => {
        const normalizedEmail = input.email.trim().toLowerCase();
        const existing = await transaction
            .select({ id: user.id })
            .from(user)
            .where(
                and(
                    eq(user.tenantId, input.tenantId),
                    sql`lower(${user.email}) = ${normalizedEmail}`,
                ),
            )
            .limit(1);

        if (existing[0] !== undefined) {
            throw new ConflictError(
                "A user with this email already exists in the tenant.",
            );
        }

        let inserted: { id: string } | undefined;
        try {
            [inserted] = await transaction
                .insert(user)
                .values({
                    tenantId: input.tenantId,
                    email: input.email.trim(),
                    displayName: input.displayName,
                    status: "invited",
                })
                .returning({ id: user.id });
        } catch (error) {
            if (isDuplicateUserEmailError(error)) {
                // The pre-insert duplicate check above cannot see a sibling
                // invite that committed concurrently under READ COMMITTED;
                // the unique index is the real backstop, so translate its
                // violation into the same conflict the sequential path returns.
                throw new ConflictError(
                    "A user with this email already exists in the tenant.",
                );
            }

            throw error;
        }

        if (inserted === undefined) {
            throw new ConflictError("The invited user could not be created.");
        }

        await transaction.insert(role).values({
            tenantId: input.tenantId,
            userId: inserted.id,
            name: input.role,
        });

        await transaction.insert(referenceDataAuditEntry).values({
            tenantId: input.tenantId,
            actorId: input.actorId,
            entityType: "user",
            entityId: inserted.id,
            action: "user_invited",
            before: {},
            after: {
                email: input.email.trim(),
                displayName: input.displayName,
                role: input.role,
                status: "invited",
            },
        });

        return readTeamUserById(input.tenantId, inserted.id, transaction);
    });
}

/**
 * Replaces a tenant user's assigned role and appends a reference audit entry.
 */
export async function updateTeamUserRole(
    input: { actorId: string; id: string; role: RoleName; tenantId: string },
    database: Database = db,
): Promise<TeamUserResponse> {
    return database.transaction(async (transaction) => {
        const existingRoles = await transaction
            .select({ name: role.name })
            .from(role)
            .where(
                and(
                    eq(role.tenantId, input.tenantId),
                    eq(role.userId, input.id),
                ),
            );

        if (existingRoles.length === 0) {
            throw new NotFoundError("Team member was not found.");
        }

        const beforeRoles = existingRoles.map((existing) => existing.name);
        if (beforeRoles.length === 1 && beforeRoles[0] === input.role) {
            return readTeamUserById(input.tenantId, input.id, transaction);
        }

        await transaction
            .delete(role)
            .where(
                and(
                    eq(role.tenantId, input.tenantId),
                    eq(role.userId, input.id),
                ),
            );
        await transaction.insert(role).values({
            tenantId: input.tenantId,
            userId: input.id,
            name: input.role,
        });

        await transaction.insert(referenceDataAuditEntry).values({
            tenantId: input.tenantId,
            actorId: input.actorId,
            entityType: "user",
            entityId: input.id,
            action: "user_role_changed",
            before: { roles: beforeRoles },
            after: { roles: [input.role] },
        });

        return readTeamUserById(input.tenantId, input.id, transaction);
    });
}

/**
 * Activates or deactivates a tenant user and appends a reference audit entry.
 */
export async function updateTeamUserStatus(
    input: {
        actorId: string;
        id: string;
        status: "active" | "deactivated";
        tenantId: string;
    },
    database: Database = db,
): Promise<TeamUserResponse> {
    return database.transaction(async (transaction) => {
        const [existing] = await transaction
            .select({ status: user.status })
            .from(user)
            .where(
                and(eq(user.tenantId, input.tenantId), eq(user.id, input.id)),
            )
            .limit(1)
            .for("update");

        if (existing === undefined) {
            throw new NotFoundError("Team member was not found.");
        }

        if (existing.status === input.status) {
            return readTeamUserById(input.tenantId, input.id, transaction);
        }

        await transaction
            .update(user)
            .set({ status: input.status, updatedAt: new Date() })
            .where(
                and(eq(user.tenantId, input.tenantId), eq(user.id, input.id)),
            );

        await transaction.insert(referenceDataAuditEntry).values({
            tenantId: input.tenantId,
            actorId: input.actorId,
            entityType: "user",
            entityId: input.id,
            action: "user_status_changed",
            before: { status: existing.status },
            after: { status: input.status },
        });

        return readTeamUserById(input.tenantId, input.id, transaction);
    });
}

async function readTeamUserById(
    tenantId: string,
    id: string,
    database: Database | Transaction,
): Promise<TeamUserResponse> {
    const [row] = await database
        .select({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            status: user.status,
            createdAt: user.createdAt,
        })
        .from(user)
        .where(and(eq(user.tenantId, tenantId), eq(user.id, id)))
        .limit(1);

    if (row === undefined) {
        throw new NotFoundError("Team member was not found.");
    }

    const roleRows = await database
        .select({ name: role.name })
        .from(role)
        .where(and(eq(role.tenantId, tenantId), eq(role.userId, id)));

    return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        status: parseUserStatus(row.status),
        roles: roleRows
            .map((r) => r.name)
            .filter(isRoleName)
            .sort(compareRoles),
        createdAt: row.createdAt.toISOString(),
    };
}

function groupRolesByUserId(
    rows: readonly { userId: string; name: string }[],
): Map<string, RoleName[]> {
    const rolesByUserId = new Map<string, RoleName[]>();

    for (const row of rows) {
        if (!isRoleName(row.name)) {
            continue;
        }

        const roles = rolesByUserId.get(row.userId) ?? [];
        roles.push(row.name);
        rolesByUserId.set(row.userId, roles);
    }

    for (const roles of rolesByUserId.values()) {
        roles.sort(compareRoles);
    }

    return rolesByUserId;
}

function isRoleName(value: string): value is RoleName {
    return (roleValues as readonly string[]).includes(value);
}

function compareRoles(firstRole: RoleName, secondRole: RoleName): number {
    return roleValues.indexOf(firstRole) - roleValues.indexOf(secondRole);
}

function parseUserStatus(value: string): TeamUserResponse["status"] {
    if (value === "invited" || value === "active" || value === "deactivated") {
        return value;
    }

    throw new Error(`Unexpected user status value: ${value}`);
}

function isDuplicateUserEmailError(error: unknown): boolean {
    const visitedErrors = new Set<object>();
    let currentError = error;

    while (
        currentError !== null &&
        typeof currentError === "object" &&
        !visitedErrors.has(currentError)
    ) {
        visitedErrors.add(currentError);
        const postgresError = currentError as PostgresError;

        if (
            postgresError.code === uniqueViolationCode &&
            postgresError.constraint === userTenantEmailConstraint
        ) {
            return true;
        }

        // Drizzle wraps driver errors; follow the cause chain without exposing database details.
        currentError = postgresError.cause;
    }

    return false;
}
