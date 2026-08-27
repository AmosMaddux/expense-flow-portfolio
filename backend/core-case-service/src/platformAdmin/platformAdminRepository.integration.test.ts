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
import { user } from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import { readTenantSummaries } from "./platformAdminRepository.js";

type PlatformAdminTestContext = {
    tenantA: string;
    tenantB: string;
};

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let context: PlatformAdminTestContext;

describe("Platform Admin repository", () => {
    beforeAll(async () => {
        client = new Client({ connectionString: getCoreCaseTestDatabaseUrl() });
        await client.connect();
        testDb = drizzle(client, { schema });
    });

    afterAll(async () => {
        await client.end().catch(() => undefined);
    });

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
