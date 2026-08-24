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
import {
    findPolicyChunksMissingEmbeddings,
    findSimilarTenantPolicyChunks,
    findTenantPolicyCorpusChunks,
    replaceTenantPolicyChunks,
    saveTenantPolicyChunkEmbedding,
} from "./policyCorpusRepository.js";
import type { ExpensePolicyChunk } from "./policyCorpusChunker.js";
import { policyChunkEmbeddingDimensions } from "../db/schema/index.js";

let client: Client;
let testDb: NodePgDatabase<typeof schema>;
let tenantA: string;
let tenantB: string;

const embeddingModel = "text-embedding-3-small";

/**
 * Builds a unit vector pointing along one axis so cosine similarity between two
 * fixtures is exactly 1 for the same axis and 0 for different axes.
 */
function unitEmbedding(axis: number): number[] {
    return Array.from(
        { length: policyChunkEmbeddingDimensions },
        (_value, index) => (index === axis ? 1 : 0),
    );
}

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

    test("stores and searches embeddings within one tenant", async () => {
        const reimbursableEmbedding = unitEmbedding(0);
        const unrelatedEmbedding = unitEmbedding(1);

        await testDb.insert(tenantExpensePolicyChunk).values([
            {
                tenantId: tenantA,
                policyHash: "policy-a",
                chunkHash: "chunk-a-meals",
                section: "Meals",
                chunkIndex: 1,
                content:
                    "Client meals are reimbursable with an itemised receipt.",
                metadata: { tenantId: tenantA, section: "Meals" },
                embedding: reimbursableEmbedding,
                embeddingModel: embeddingModel,
                embeddedAt: new Date(),
            },
            {
                tenantId: tenantA,
                policyHash: "policy-a",
                chunkHash: "chunk-a-parking",
                section: "Parking",
                chunkIndex: 2,
                content: "Parking fines are never reimbursable.",
                metadata: { tenantId: tenantA, section: "Parking" },
                embedding: unrelatedEmbedding,
                embeddingModel: embeddingModel,
                embeddedAt: new Date(),
            },
            {
                tenantId: tenantB,
                policyHash: "policy-b",
                chunkHash: "chunk-b-meals",
                section: "Meals",
                chunkIndex: 1,
                content: "Tenant B client meals are reimbursable.",
                metadata: { tenantId: tenantB, section: "Meals" },
                // Identical to the tenant A vector: a tenant-scoped search must
                // still never surface it for tenant A.
                embedding: reimbursableEmbedding,
                embeddingModel: embeddingModel,
                embeddedAt: new Date(),
            },
        ]);

        const results = await findSimilarTenantPolicyChunks(
            {
                tenantId: tenantA,
                embedding: reimbursableEmbedding,
                embeddingModel,
                limit: 5,
            },
            testDb,
        );

        expect(results.every((chunk) => chunk.tenantId === tenantA)).toBe(true);
        expect(results[0]?.chunkHash).toBe("chunk-a-meals");
        expect(results[0]?.similarity).toBeGreaterThan(0.99);
        expect(results[0]?.metadata).toMatchObject({ tenantId: tenantA });
        expect(results.map((chunk) => chunk.chunkHash)).not.toContain(
            "chunk-b-meals",
        );
        // The unembedded seed chunk must stay out of similarity results.
        expect(results.map((chunk) => chunk.chunkHash)).not.toContain(
            "chunk-a",
        );
    });

    test("backfills a chunk embedding and clears it from the pending set", async () => {
        const [pending] = await findPolicyChunksMissingEmbeddings(
            { tenantId: tenantA, embeddingModel, limit: 10 },
            testDb,
        );

        expect(pending?.chunkHash).toBe("chunk-a");

        const saved = await saveTenantPolicyChunkEmbedding(
            {
                id: pending?.id ?? "",
                tenantId: tenantA,
                chunkHash: pending?.chunkHash ?? "",
                embedding: unitEmbedding(2),
                embeddingModel,
            },
            testDb,
        );

        expect(saved).toBe(true);
        await expect(
            findPolicyChunksMissingEmbeddings(
                { tenantId: tenantA, embeddingModel, limit: 10 },
                testDb,
            ),
        ).resolves.toHaveLength(0);
    });

    test("refuses to attach an embedding to replaced chunk text", async () => {
        const [pending] = await findPolicyChunksMissingEmbeddings(
            { tenantId: tenantA, embeddingModel, limit: 10 },
            testDb,
        );

        const saved = await saveTenantPolicyChunkEmbedding(
            {
                id: pending?.id ?? "",
                tenantId: tenantA,
                chunkHash: "chunk-hash-from-an-older-policy",
                embedding: unitEmbedding(3),
                embeddingModel,
            },
            testDb,
        );

        expect(saved).toBe(false);
    });

    test("refuses to write an embedding across tenants", async () => {
        const [pending] = await findPolicyChunksMissingEmbeddings(
            { tenantId: tenantA, embeddingModel, limit: 10 },
            testDb,
        );

        const saved = await saveTenantPolicyChunkEmbedding(
            {
                id: pending?.id ?? "",
                tenantId: tenantB,
                chunkHash: pending?.chunkHash ?? "",
                embedding: unitEmbedding(4),
                embeddingModel,
            },
            testDb,
        );

        expect(saved).toBe(false);
    });

    test("excludes vectors embedded by a different model from ranking", async () => {
        const currentModelEmbedding = unitEmbedding(0);

        await testDb.insert(tenantExpensePolicyChunk).values([
            {
                tenantId: tenantA,
                policyHash: "policy-a",
                chunkHash: "chunk-a-current-model",
                section: "Meals",
                chunkIndex: 1,
                content: "Tenant A meals are reimbursable.",
                metadata: {},
                embedding: currentModelEmbedding,
                embeddingModel,
                embeddedAt: new Date(),
            },
            {
                tenantId: tenantA,
                policyHash: "policy-a",
                chunkHash: "chunk-a-stale-model",
                section: "Meals",
                chunkIndex: 2,
                content:
                    "Tenant A meals were reimbursable under the old model.",
                metadata: {},
                // An identical vector from a different model. Cosine distance
                // cannot tell the two spaces apart, so only the model predicate
                // keeps this chunk out of ranking during a migration.
                embedding: currentModelEmbedding,
                embeddingModel: "text-embedding-3-large",
                embeddedAt: new Date(),
            },
        ]);

        const results = await findSimilarTenantPolicyChunks(
            {
                tenantId: tenantA,
                embedding: currentModelEmbedding,
                embeddingModel,
                limit: 10,
            },
            testDb,
        );

        expect(results.map((chunk) => chunk.chunkHash)).toStrictEqual([
            "chunk-a-current-model",
        ]);
        expect(results.map((chunk) => chunk.chunkHash)).not.toContain(
            "chunk-a-stale-model",
        );
    });

    test("embeds a corpus that was first loaded without an embedding provider", async () => {
        const chunk: ExpensePolicyChunk = {
            tenantId: tenantA,
            policyHash: "policy-embed",
            chunkHash: "chunk-embed-0",
            section: "Receipts",
            chunkIndex: 0,
            content: "Receipts are required over 25 dollars.",
            metadata: {
                tenantId: tenantA,
                section: "Receipts",
                chunkIndex: 0,
                policyHash: "policy-embed",
                chunkHash: "chunk-embed-0",
                source: "tenant_expense_policy",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        };

        // First load: no embedding provider configured.
        const withoutEmbeddings = await replaceTenantPolicyChunks(
            {
                tenantId: tenantA,
                policyHash: "policy-embed",
                chunks: [chunk],
            },
            testDb,
        );

        expect(withoutEmbeddings.unchanged).toBe(false);
        const [storedWithout] = await findTenantPolicyCorpusChunks(
            tenantA,
            testDb,
        );
        expect(storedWithout?.embedding).toBeNull();

        // Second load: same text, but credentials are now available.
        const withEmbeddings = await replaceTenantPolicyChunks(
            {
                tenantId: tenantA,
                policyHash: "policy-embed",
                chunks: [chunk],
                embeddings: new Map([[chunk.chunkHash, unitEmbedding(3)]]),
                embeddingModel,
            },
            testDb,
        );

        expect(withEmbeddings.unchanged).toBe(false);
        const [storedWith] = await findTenantPolicyCorpusChunks(
            tenantA,
            testDb,
        );
        expect(storedWith?.embedding).not.toBeNull();
        expect(storedWith?.embeddingModel).toBe(embeddingModel);

        // Third load: nothing left to do, so the write is skipped.
        const alreadyEmbedded = await replaceTenantPolicyChunks(
            {
                tenantId: tenantA,
                policyHash: "policy-embed",
                chunks: [chunk],
                embeddings: new Map([[chunk.chunkHash, unitEmbedding(3)]]),
                embeddingModel,
            },
            testDb,
        );

        expect(alreadyEmbedded.unchanged).toBe(true);
    });

    test("re-embeds a corpus whose vectors came from a different model", async () => {
        const chunk: ExpensePolicyChunk = {
            tenantId: tenantA,
            policyHash: "policy-migrate",
            chunkHash: "chunk-migrate-0",
            section: "Mileage",
            chunkIndex: 0,
            content: "Mileage is reimbursed at 67 cents per mile.",
            metadata: {
                tenantId: tenantA,
                section: "Mileage",
                chunkIndex: 0,
                policyHash: "policy-migrate",
                chunkHash: "chunk-migrate-0",
                source: "tenant_expense_policy",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        };
        const embeddings = new Map([[chunk.chunkHash, unitEmbedding(5)]]);

        await replaceTenantPolicyChunks(
            {
                tenantId: tenantA,
                policyHash: "policy-migrate",
                chunks: [chunk],
                embeddings,
                embeddingModel: "text-embedding-3-large",
            },
            testDb,
        );

        const migrated = await replaceTenantPolicyChunks(
            {
                tenantId: tenantA,
                policyHash: "policy-migrate",
                chunks: [chunk],
                embeddings,
                embeddingModel,
            },
            testDb,
        );

        expect(migrated.unchanged).toBe(false);
        const [stored] = await findTenantPolicyCorpusChunks(tenantA, testDb);
        expect(stored?.embeddingModel).toBe(embeddingModel);
    });

    test("returns only chunks for the requested tenant", async () => {
        const chunks = await findTenantPolicyCorpusChunks(tenantA, testDb);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.tenantId).toBe(tenantA);
        expect(chunks[0]?.content).toBe("Tenant A receipts are required.");
    });
});
