import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

import * as schema from "../db/schema/index.js";
import {
    referenceDataAuditEntry,
    role,
    user,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError } from "../errors/problem-json.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import {
    inviteTeamUser,
    readTeamUsers,
    updateTeamUserRole,
    updateTeamUserStatus,
} from "./teamUsersRepository.js";

type TeamUsersTestContext = {
    tenantA: string;
    tenantB: string;
    actorId: string;
    employeeA: string;
    managerA: string;
    employeeB: string;
};

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let context: TeamUsersTestContext;

describe("Team Users repository", () => {
    beforeAll(async () => {
        client = new Client({ connectionString: getCoreCaseTestDatabaseUrl() });
        await client.connect();
        testDb = drizzle(client, { schema });
    });

    afterAll(async () => {
        await client.end().catch(() => undefined);
    });

    beforeEach(async () => {
        context = createTeamUsersTestContext();
        await testDb.transaction(async (transaction) => {
            await transaction.insert(user).values([
                {
                    id: context.employeeA,
                    tenantId: context.tenantA,
                    email: "employee-a@example.invalid",
                    displayName: "Employee A",
                    status: "active",
                },
                {
                    id: context.managerA,
                    tenantId: context.tenantA,
                    email: "manager-a@example.invalid",
                    displayName: "Manager A",
                    status: "active",
                },
                {
                    id: context.employeeB,
                    tenantId: context.tenantB,
                    email: "employee-b@example.invalid",
                    displayName: "Employee B",
                    status: "active",
                },
            ]);
            await transaction.insert(role).values([
                {
                    tenantId: context.tenantA,
                    userId: context.employeeA,
                    name: "Employee",
                },
                {
                    tenantId: context.tenantA,
                    userId: context.managerA,
                    name: "Department Manager",
                },
                {
                    tenantId: context.tenantB,
                    userId: context.employeeB,
                    name: "Employee",
                },
            ]);
        });
    });

    afterEach(async () => {
        await testDb.transaction(async (transaction) => {
            await transaction
                .delete(role)
                .where(eq(role.tenantId, context.tenantA));
            await transaction
                .delete(role)
                .where(eq(role.tenantId, context.tenantB));
            await transaction
                .delete(user)
                .where(eq(user.tenantId, context.tenantA));
            await transaction
                .delete(user)
                .where(eq(user.tenantId, context.tenantB));
        });
    });

    test("lists only the authenticated tenant's users", async () => {
        const users = await readTeamUsers(context.tenantA, testDb);

        expect(users.map((teamUser) => teamUser.id).sort()).toStrictEqual(
            [context.employeeA, context.managerA].sort(),
        );
        expect(JSON.stringify(users)).not.toContain(context.employeeB);
    });

    test("invites a new tenant user with an assigned role and writes one audit entry", async () => {
        const invited = await inviteTeamUser(
            {
                actorId: context.actorId,
                displayName: "New Hire",
                email: "new-hire@example.invalid",
                role: "Employee",
                tenantId: context.tenantA,
            },
            testDb,
        );

        expect(invited).toMatchObject({
            displayName: "New Hire",
            email: "new-hire@example.invalid",
            roles: ["Employee"],
            status: "invited",
        });

        const auditRows = await readAuditRows(context.tenantA, invited.id);
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "user_invited",
            actorId: context.actorId,
            entityId: invited.id,
            entityType: "user",
            tenantId: context.tenantA,
        });
    });

    test("rejects inviting a duplicate email within the same tenant", async () => {
        await expect(
            inviteTeamUser(
                {
                    actorId: context.actorId,
                    displayName: "Duplicate",
                    email: "employee-a@example.invalid",
                    role: "Employee",
                    tenantId: context.tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    test("rejects the losing side of two concurrent invites for the same email with a Conflict, not a raw error", async () => {
        // A single shared connection would just serialize these two calls,
        // so each invite gets its own connection to genuinely race the
        // duplicate-check SELECT against the sibling's INSERT, the way two
        // independent Finance Admin requests would in production.
        const secondClient = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        await secondClient.connect();
        const secondTestDb = drizzle(secondClient, { schema });

        try {
            const inviteInput = {
                actorId: context.actorId,
                displayName: "Race Hire",
                email: "race-hire@example.invalid",
                role: "Employee" as const,
                tenantId: context.tenantA,
            };

            const results = await Promise.allSettled([
                inviteTeamUser(inviteInput, testDb),
                inviteTeamUser(inviteInput, secondTestDb),
            ]);

            const fulfilled = results.filter(
                (result) => result.status === "fulfilled",
            );
            const rejected = results.filter(
                (result) => result.status === "rejected",
            );

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(
                (rejected[0] as PromiseRejectedResult).reason,
            ).toBeInstanceOf(ConflictError);
        } finally {
            await secondClient.end().catch(() => undefined);
        }
    });

    test("replaces a tenant user's role and writes one audit entry", async () => {
        const updated = await updateTeamUserRole(
            {
                actorId: context.actorId,
                id: context.employeeA,
                role: "Finance Admin",
                tenantId: context.tenantA,
            },
            testDb,
        );

        expect(updated.roles).toStrictEqual(["Finance Admin"]);

        const roleRows = await testDb
            .select({ name: role.name })
            .from(role)
            .where(
                and(
                    eq(role.tenantId, context.tenantA),
                    eq(role.userId, context.employeeA),
                ),
            );
        expect(roleRows).toStrictEqual([{ name: "Finance Admin" }]);

        const auditRows = await readAuditRows(context.tenantA, context.employeeA);
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({ action: "user_role_changed" });
        expect(auditRows[0]?.before).toStrictEqual({ roles: ["Employee"] });
        expect(auditRows[0]?.after).toStrictEqual({ roles: ["Finance Admin"] });
    });

    test("rejects role changes for a user outside the tenant", async () => {
        await expect(
            updateTeamUserRole(
                {
                    actorId: context.actorId,
                    id: context.employeeB,
                    role: "Finance Admin",
                    tenantId: context.tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    test("deactivates and reactivates a tenant user, writing one audit entry per change", async () => {
        const deactivated = await updateTeamUserStatus(
            {
                actorId: context.actorId,
                id: context.employeeA,
                status: "deactivated",
                tenantId: context.tenantA,
            },
            testDb,
        );
        expect(deactivated.status).toBe("deactivated");

        const reactivated = await updateTeamUserStatus(
            {
                actorId: context.actorId,
                id: context.employeeA,
                status: "active",
                tenantId: context.tenantA,
            },
            testDb,
        );
        expect(reactivated.status).toBe("active");

        const auditRows = await readAuditRows(context.tenantA, context.employeeA);
        expect(auditRows).toHaveLength(2);
        expect(auditRows.map((row) => row.action)).toStrictEqual([
            "user_status_changed",
            "user_status_changed",
        ]);
    });

    test("does not audit a no-op status update", async () => {
        await updateTeamUserStatus(
            {
                actorId: context.actorId,
                id: context.employeeA,
                status: "active",
                tenantId: context.tenantA,
            },
            testDb,
        );

        await expect(
            readAuditRows(context.tenantA, context.employeeA),
        ).resolves.toHaveLength(0);
    });
});

function createTeamUsersTestContext(): TeamUsersTestContext {
    return {
        tenantA: randomUUID(),
        tenantB: randomUUID(),
        actorId: randomUUID(),
        employeeA: randomUUID(),
        managerA: randomUUID(),
        employeeB: randomUUID(),
    };
}

async function readAuditRows(tenantId: string, entityId: string) {
    return testDb
        .select()
        .from(referenceDataAuditEntry)
        .where(
            and(
                eq(referenceDataAuditEntry.tenantId, tenantId),
                eq(referenceDataAuditEntry.entityId, entityId),
            ),
        );
}
