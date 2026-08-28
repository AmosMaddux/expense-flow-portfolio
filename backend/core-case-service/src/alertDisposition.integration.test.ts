import { randomUUID } from "node:crypto";

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Client } from "pg";

import { getCoreCaseTestDatabaseUrl } from "./testSupport/coreCaseTestDatabase.js";
import * as schema from "./db/schema/index.js";
import { alertDisposition } from "./db/schema/index.js";
import { readAlertDispositions } from "./alertDisposition.js";

type AlertDispositionTestContext = {
    tenantA: string;
    tenantB: string;
    tenantAOldDispositionId: string;
    tenantANewDispositionId: string;
    tenantBDispositionId: string;
};

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let context: AlertDispositionTestContext;

describe("readAlertDispositions", () => {
    beforeAll(async () => {
        client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        await client.connect();
        testDb = drizzle(client, { schema });
    });

    afterAll(async () => {
        await client.end();
    });

    beforeEach(async () => {
        context = {
            tenantA: randomUUID(),
            tenantB: randomUUID(),
            tenantAOldDispositionId: randomUUID(),
            tenantANewDispositionId: randomUUID(),
            tenantBDispositionId: randomUUID(),
        };

        await testDb.insert(alertDisposition).values([
            {
                id: context.tenantAOldDispositionId,
                tenantId: context.tenantA,
                alertId: "alert-a-old",
                alertName: "Tenant A old alert",
                source: "monitoring",
                severity: "medium",
                status: "investigated",
                resolution: "Tenant A investigation complete.",
                correlationId: null,
                traceId: null,
                investigatedBy: randomUUID(),
                notes: null,
                resolvedAt: null,
                createdAt: new Date("2026-08-27T10:00:00.000Z"),
            },
            {
                id: context.tenantANewDispositionId,
                tenantId: context.tenantA,
                alertId: "alert-a-new",
                alertName: "Tenant A new alert",
                source: "monitoring",
                severity: "high",
                status: "resolved",
                resolution: "Tenant A resolution complete.",
                correlationId: null,
                traceId: null,
                investigatedBy: randomUUID(),
                notes: null,
                resolvedAt: new Date("2026-08-27T11:00:00.000Z"),
                createdAt: new Date("2026-08-27T11:00:00.000Z"),
            },
            {
                id: context.tenantBDispositionId,
                tenantId: context.tenantB,
                alertId: "alert-b-newest",
                alertName: "Tenant B new alert",
                source: "monitoring",
                severity: "critical",
                status: "resolved",
                resolution: "Tenant B resolution complete.",
                correlationId: null,
                traceId: null,
                investigatedBy: randomUUID(),
                notes: null,
                resolvedAt: new Date("2026-08-27T12:00:00.000Z"),
                createdAt: new Date("2026-08-27T12:00:00.000Z"),
            },
        ]);
    });

    test("returns only the caller tenant's alert dispositions", async () => {
        const rows = await readAlertDispositions(
            {
                tenantId: context.tenantA,
                limit: 10,
            },
            testDb,
        );

        expect(rows.map((row) => row.id)).toStrictEqual([
            context.tenantANewDispositionId,
            context.tenantAOldDispositionId,
        ]);
        expect(JSON.stringify(rows)).not.toContain(context.tenantB);
    });

    afterEach(async () => {
        await testDb
            .delete(alertDisposition)
            .where(eq(alertDisposition.tenantId, context.tenantA));
        await testDb
            .delete(alertDisposition)
            .where(eq(alertDisposition.tenantId, context.tenantB));
    });
});
