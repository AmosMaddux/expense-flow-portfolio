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
        // reference_data_audit_entry rows can't be cleaned up here: a DB
        // trigger rejects DELETE/UPDATE on this table outright (it's truly
        // append-only, not just append-only by convention), so the rows this
        // suite inserts are left behind on purpose. That's safe only because
        // this integration suite runs against a disposable, per-run
        // Testcontainers Postgres instance (see coreCaseTestDatabase.ts) that
        // is torn down afterward — orphaned rows never accumulate across
        // runs or reach the 200-ish row range that would affect pagination
        // in these tests. Only the seeded user row is cleaned up.
        await testDb.delete(user).where(inArray(user.tenantId, [auditTenantId]));
    });

    test("reads audit events with actor metadata, not scoped to a single tenant", async () => {
        const page = await readAuditLogEvents(
            { pageSize: 200 },
            testDb,
        );
        const event = page.events.find((candidate) =>
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

    test("paginates by (created_at, id) with a stable, gap-free cursor across the page boundary", async () => {
        // The table is written concurrently by other integration suites in
        // this shared test database, so this test can't assume it owns the
        // whole table or know its total size. It only asserts the keyset
        // invariants that must hold regardless of what else is in there:
        // each page is ordered, and the boundary between two adjacent pages
        // has no gap and no overlap. Four more rows (on top of the one
        // seeded in beforeEach) guarantee at least one full pageSize=3 page
        // plus a remainder, so a next page is available to check.
        await testDb.insert(referenceDataAuditEntry).values([
            {
                tenantId: auditTenantId,
                actorId,
                entityType: "user",
                entityId: randomUUID(),
                action: "user_role_changed",
                before: {},
                after: {},
            },
            {
                tenantId: auditTenantId,
                actorId,
                entityType: "user",
                entityId: randomUUID(),
                action: "user_status_changed",
                before: {},
                after: {},
            },
            {
                tenantId: auditTenantId,
                actorId,
                entityType: "user",
                entityId: randomUUID(),
                action: "user_role_changed",
                before: {},
                after: {},
            },
            {
                tenantId: auditTenantId,
                actorId,
                entityType: "user",
                entityId: randomUUID(),
                action: "user_status_changed",
                before: {},
                after: {},
            },
        ]);

        const firstPage = await readAuditLogEvents({ pageSize: 3 }, testDb);
        expect(firstPage.events.length).toBe(3);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(isStrictlyDescendingByCursorKey(firstPage.events)).toBe(true);

        const secondPage = await readAuditLogEvents(
            { cursor: firstPage.nextCursor ?? undefined, pageSize: 3 },
            testDb,
        );
        expect(isStrictlyDescendingByCursorKey(secondPage.events)).toBe(true);

        const firstPageIds = new Set(
            firstPage.events.map((event) => event.id),
        );
        for (const event of secondPage.events) {
            expect(firstPageIds.has(event.id)).toBe(false);
        }

        const lastOfFirstPage = firstPage.events.at(-1);
        if (lastOfFirstPage === undefined) {
            throw new Error("First page unexpectedly had no events.");
        }
        for (const event of secondPage.events) {
            expect(isBeforeInCursorOrder(event, lastOfFirstPage)).toBe(true);
        }
    });
});

type CursorOrderedEvent = { id: string; occurredAt: string };

function isBeforeInCursorOrder(
    candidate: CursorOrderedEvent,
    reference: CursorOrderedEvent,
): boolean {
    if (candidate.occurredAt !== reference.occurredAt) {
        return candidate.occurredAt < reference.occurredAt;
    }

    return candidate.id < reference.id;
}

function isStrictlyDescendingByCursorKey(
    events: readonly CursorOrderedEvent[],
): boolean {
    for (let index = 1; index < events.length; index += 1) {
        const previous = events[index - 1];
        const current = events[index];
        if (
            previous === undefined ||
            current === undefined ||
            !isBeforeInCursorOrder(current, previous)
        ) {
            return false;
        }
    }

    return true;
}
