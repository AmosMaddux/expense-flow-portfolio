import { describe, expect, test, vi } from "vitest";

import type {
    SimilarPolicyChunkRecord,
    TenantExpensePolicyChunkRecord,
} from "./policyCorpusRepository.js";
import {
    RetrievePolicyChunksRequestSchema,
    RetrievePolicyChunksResponseSchema,
    retrievePolicyChunks,
} from "./policyRetrievalService.js";

const tenantA = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const tenantB = "9f3cacc2-0a83-4921-c9c2-b13b36dee3ac";

function chunk(
    tenantId: string,
    chunkIndex: number,
    section: string,
    content: string,
): TenantExpensePolicyChunkRecord {
    return {
        id: `40000000-0000-4000-8000-${String(chunkIndex + 1).padStart(12, "0")}`,
        tenantId,
        policyHash: `policy-${tenantId}`,
        chunkHash: `chunk-${tenantId}-${chunkIndex}`,
        section,
        chunkIndex,
        content,
        metadata: {},
        embedding: null,
        embeddingModel: null,
        embeddedAt: null,
        createdAt: new Date("2026-08-20T12:00:00.000Z"),
        updatedAt: new Date("2026-08-20T12:00:00.000Z"),
    };
}

function similarChunk(
    record: TenantExpensePolicyChunkRecord,
    similarity: number,
): SimilarPolicyChunkRecord {
    return { ...record, similarity };
}

function noVectorSearch(): {
    findSimilarTenantPolicyChunks: ReturnType<typeof vi.fn>;
} {
    return { findSimilarTenantPolicyChunks: vi.fn().mockResolvedValue([]) };
}

void describe("retrievePolicyChunks", () => {
    void test("ranks the most relevant meals and receipt chunk first", async () => {
        const repository = {
            ...noVectorSearch(),
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(
                        tenantA,
                        0,
                        "Travel",
                        "Economy airfare is reimbursable for approved business travel.",
                    ),
                    chunk(
                        tenantA,
                        1,
                        "Meals and Receipts",
                        "Meals require a receipt and a business purpose for reimbursement.",
                    ),
                ]),
        };

        const response = await retrievePolicyChunks(
            {
                tenantId: tenantA,
                query: "meals receipt",
                topK: 2,
            },
            repository,
        );

        expect(response.chunks[0]?.section).toBe("Meals and Receipts");
        expect(response.chunks[0]?.score).toBeGreaterThan(
            response.chunks[1]?.score ?? 0,
        );
        expect(response.chunks[0]?.citation).toContain("policy-");
        expect(response.chunks[0]?.citation).toContain("chunk-1");
        expect(RetrievePolicyChunksResponseSchema.parse(response)).toEqual(
            response,
        );
    });

    void test("respects topK and calls the repository with the validated tenant", async () => {
        const repository = {
            ...noVectorSearch(),
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantA, 0, "Meals", "Receipts are required."),
                    chunk(tenantA, 1, "Travel", "Travel is reimbursable."),
                    chunk(tenantA, 2, "Mileage", "Mileage is reimbursable."),
                ]),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "reimbursable", topK: 1 },
            repository,
        );

        expect(repository.findTenantPolicyCorpusChunks).toHaveBeenCalledWith(
            tenantA,
        );
        expect(response.chunks).toHaveLength(1);
    });

    void test("does not return chunks outside the requesting tenant", async () => {
        const repository = {
            ...noVectorSearch(),
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantB, 0, "Meals", "Synthetic tenant B policy."),
                    chunk(tenantA, 1, "Meals", "Synthetic tenant A policy."),
                ]),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "policy", topK: 5 },
            repository,
        );

        expect(response.chunks).toHaveLength(1);
        expect(response.chunks[0]?.tenantId).toBe(tenantA);
    });

    void test("uses section and exact phrase boosts for ranking", async () => {
        const repository = {
            ...noVectorSearch(),
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(
                        tenantA,
                        0,
                        "General",
                        "Receipts are required for all expenses.",
                    ),
                    chunk(
                        tenantA,
                        1,
                        "Receipt Requirements",
                        "Receipt requirements apply to meals and lodging.",
                    ),
                ]),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "receipt requirements", topK: 2 },
            repository,
        );

        expect(response.chunks[0]?.chunkIndex).toBe(1);
    });

    void test("returns the first chunks when every score is zero", async () => {
        const repository = {
            ...noVectorSearch(),
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantA, 2, "Travel", "Economy airfare."),
                    chunk(tenantA, 0, "Meals", "Business meals."),
                ]),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "unmatched term", topK: 1 },
            repository,
        );

        expect(response.chunks).toHaveLength(1);
        expect(response.chunks[0]?.chunkIndex).toBe(0);
        expect(response.chunks[0]?.score).toBe(0);
    });

    void test("blends vector similarity into the ranking", async () => {
        const lexicalOnlyMatch = chunk(
            tenantA,
            0,
            "Travel",
            "Travel spend needs approval.",
        );
        const semanticMatch = chunk(
            tenantA,
            1,
            "Client Entertainment",
            "Taking a customer to dinner is reimbursable with itemised proof of purchase.",
        );
        const repository = {
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([lexicalOnlyMatch, semanticMatch]),
            findSimilarTenantPolicyChunks: vi
                .fn()
                .mockResolvedValue([similarChunk(semanticMatch, 0.92)]),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
        };

        const response = await retrievePolicyChunks(
            {
                tenantId: tenantA,
                query: "can I expense a client dinner",
                topK: 2,
            },
            repository,
            embedder,
        );

        expect(repository.findSimilarTenantPolicyChunks).toHaveBeenCalledWith({
            tenantId: tenantA,
            embedding: [0.1, 0.2, 0.3],
            // Ranking must only ever compare vectors from the model that
            // embedded the query.
            embeddingModel: "text-embedding-3-small",
            limit: 20,
        });
        expect(response.chunks[0]?.section).toBe("Client Entertainment");
        expect(response.chunks[0]?.vectorSimilarity).toBe(0.92);
        expect(response.chunks[0]?.score).toBeGreaterThan(
            response.chunks[0]?.lexicalScore ?? 0,
        );
        expect(RetrievePolicyChunksResponseSchema.parse(response)).toEqual(
            response,
        );
    });

    void test("ignores vector candidates from another tenant", async () => {
        const tenantAChunk = chunk(
            tenantA,
            0,
            "Meals",
            "Tenant A meals policy.",
        );
        const tenantBChunk = chunk(
            tenantB,
            1,
            "Meals",
            "Tenant B meals policy.",
        );
        const repository = {
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([tenantAChunk]),
            findSimilarTenantPolicyChunks: vi
                .fn()
                .mockResolvedValue([similarChunk(tenantBChunk, 0.99)]),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.4]]),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "meals", topK: 5 },
            repository,
            embedder,
        );

        expect(response.chunks).toHaveLength(1);
        expect(response.chunks[0]?.tenantId).toBe(tenantA);
        expect(response.chunks[0]?.vectorSimilarity).toBeNull();
    });

    void test("falls back to lexical ranking when embedding fails", async () => {
        const repository = {
            findTenantPolicyCorpusChunks: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantA, 0, "Meals", "Meals need a receipt."),
                ]),
            findSimilarTenantPolicyChunks: vi.fn(),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi
                .fn()
                .mockRejectedValue(new Error("provider unavailable")),
        };

        const response = await retrievePolicyChunks(
            { tenantId: tenantA, query: "meals receipt", topK: 5 },
            repository,
            embedder,
        );

        expect(response.chunks).toHaveLength(1);
        expect(response.chunks[0]?.vectorSimilarity).toBeNull();
        expect(response.chunks[0]?.score).toBe(
            response.chunks[0]?.lexicalScore,
        );
        expect(repository.findSimilarTenantPolicyChunks).not.toHaveBeenCalled();
    });

    void test("validates request and response shapes", () => {
        expect(() =>
            RetrievePolicyChunksRequestSchema.parse({
                tenantId: "not-a-uuid",
                query: "   ",
                topK: 11,
            }),
        ).toThrow();
        expect(() =>
            RetrievePolicyChunksRequestSchema.parse({
                tenantId: tenantA,
                query: "meals",
                unexpected: true,
            }),
        ).toThrow();
    });
});
