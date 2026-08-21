import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
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
import { tenantExpensePolicyChunk } from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import { findTenantPolicyCorpusChunks } from "./policyCorpusRepository.js";

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let tenantA: string;
let tenantB: string;

void describe("policy corpus repository", () => {
    beforeAll(async () => {
        client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        await client.connect();
        testDb = drizzle(client, { schema });
    });

    afterAll(async () => {
        await client.end().catch(() => undefined);
    });

    beforeEach(async () => {
        tenantA = randomUUID();
        tenantB = randomUUID();
        await testDb.insert(tenantExpensePolicyChunk).values([
            {
                tenantId: tenantA,
                policyHash: "policy-a",
                chunkHash: "chunk-a",
                section: "Meals",
                chunkIndex: 0,
                content: "Tenant A receipts are required.",
                metadata: {},
            },
            {
                tenantId: tenantB,
                policyHash: "policy-b",
                chunkHash: "chunk-b",
                section: "Meals",
                chunkIndex: 0,
                content: "Tenant B receipts are required.",
                metadata: {},
            },
        ]);
    });

    afterEach(async () => {
        await testDb
            .delete(tenantExpensePolicyChunk)
            .where(eq(tenantExpensePolicyChunk.tenantId, tenantA));
        await testDb
            .delete(tenantExpensePolicyChunk)
            .where(eq(tenantExpensePolicyChunk.tenantId, tenantB));
    });

    test("returns only chunks for the requested tenant", async () => {
        const chunks = await findTenantPolicyCorpusChunks(tenantA, testDb);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.tenantId).toBe(tenantA);
        expect(chunks[0]?.content).toBe("Tenant A receipts are required.");
    });
});
