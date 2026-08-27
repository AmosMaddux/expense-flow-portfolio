import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
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
import { referenceDataAuditEntry, user } from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import {
    readAuditLogEvents,
    readTenantSummaries,
} from "./platformAdminRepository.js";

type PlatformAdminTestContext = {
    tenantA: string;
    tenantB: string;
};

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let context: PlatformAdminTestContext;

beforeAll(async () => {
    client = new Client({ connectionString: getCoreCaseTestDatabaseUrl() });
    await client.connect();
    testDb = drizzle(client, { schema });
});

afterAll(async () => {
    await client.end().catch(() => undefined);
});

describe("Platform Admin repository", () => {
    beforeEach(async () => {
        context = { tenantA: randomUUID(), tenantB: randomUUID() };
        await testDb.insert(user).values([
            {
                tenantId: context.tenantA,
                email: "employee-a1@example.invalid",
                displayName: "Employee A1",
                status: "active",
            },
            {
                tenantId: context.tenantA,
                email: "employee-a2@example.invalid",
                displayName: "Employee A2",
                status: "invited",
            },
            {
                tenantId: context.tenantB,
                email: "employee-b1@example.invalid",
                displayName: "Employee B1",
                status: "deactivated",
            },
        ]);
    });

    afterEach(async () => {
        await testDb
            .delete(user)
            .where(inArray(user.tenantId, [context.tenantA, context.tenantB]));
    });

    test("summarizes user counts by status across every tenant", async () => {
        const tenants = await readTenantSummaries(testDb);
        const byTenantId = new Map(
            tenants
                .filter((tenant) =>
                    [context.tenantA, context.tenantB].includes(
                        tenant.tenantId,
                    ),
                )
                .map((tenant) => [tenant.tenantId, tenant]),
        );

        expect(byTenantId.get(context.tenantA)).toStrictEqual({
            tenantId: context.tenantA,
            userCount: 2,
            activeUserCount: 1,
            invitedUserCount: 1,
            deactivatedUserCount: 0,
        });
        expect(byTenantId.get(context.tenantB)).toStrictEqual({
            tenantId: context.tenantB,
            userCount: 1,
            activeUserCount: 0,
            invitedUserCount: 0,
            deactivatedUserCount: 1,
        });
    });

    test("does not scope results to a single tenant", async () => {
        const tenants = await readTenantSummaries(testDb);
        const tenantIds = tenants.map((tenant) => tenant.tenantId);

        expect(tenantIds).toContain(context.tenantA);
        expect(tenantIds).toContain(context.tenantB);
    });
});

describe("readAuditLogEvents", () => {
    let auditTenantId: string;
    let actorId: string;
    let entryIds: string[];

    beforeEach(async () => {
        auditTenantId = randomUUID();
        const insertedUsers = await testDb
            .insert(user)
            .values({
                tenantId: auditTenantId,
                email: "audit-actor@example.invalid",
                displayName: "Audit Actor",
                status: "active",
            })
            .returning({ id: user.id });
        const actor = insertedUsers[0];
        if (actor === undefined) {
            throw new Error("Audit actor user was not created.");
        }
        actorId = actor.id;

        const inserted = await testDb
            .insert(referenceDataAuditEntry)
            .values({
                tenantId: auditTenantId,
                actorId,
                entityType: "user",
                entityId: randomUUID(),
                action: "user_invited",
                before: {},
                after: { email: "invitee@example.invalid" },
            })
            .returning({ id: referenceDataAuditEntry.id });
        entryIds = inserted.map((row) => row.id);
    });

    afterEach(async () => {
        // reference_data_audit_entry rows are append-only; only the seeded
        // user row is cleaned up.
        await testDb.delete(user).where(inArray(user.tenantId, [auditTenantId]));
    });

    test("reads audit events with actor metadata, not scoped to a single tenant", async () => {
        const events = await readAuditLogEvents(testDb);
        const event = events.find((candidate) =>
            entryIds.includes(candidate.id),
        );

        expect(event).toBeDefined();
        expect(event?.tenantId).toBe(auditTenantId);
        expect(event?.entityType).toBe("user");
        expect(event?.action).toBe("user_invited");
        expect(event?.actor).toStrictEqual({
            id: actorId,
            email: "audit-actor@example.invalid",
            displayName: "Audit Actor",
        });
    });
});
