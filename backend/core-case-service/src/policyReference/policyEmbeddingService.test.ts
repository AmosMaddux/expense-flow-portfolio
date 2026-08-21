import { describe, expect, test, vi } from "vitest";

import type { TenantExpensePolicyChunkRecord } from "./policyCorpusRepository.js";
import {
    createOptionalPolicyEmbedder,
    embedPolicyCorpus,
    embedPolicyQuery,
    embeddingInputForChunk,
} from "./policyEmbeddingService.js";
import { PolicyEmbeddingServiceError } from "./policyEmbeddingErrors.js";

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

void describe("embedPolicyCorpus", () => {
    void test("embeds pending chunks and stores them against the owning tenant", async () => {
        const pendingChunks = [
            chunk(tenantA, 0, "Meals", "Meals require a receipt."),
            chunk(tenantB, 1, "Mileage", "Mileage is reimbursable."),
        ];
        const repository = {
            findPolicyChunksMissingEmbeddings: vi
                .fn()
                .mockResolvedValue(pendingChunks),
            saveTenantPolicyChunkEmbedding: vi.fn().mockResolvedValue(true),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.1], [0.2]]),
        };

        const summary = await embedPolicyCorpus({}, embedder, repository);

        expect(embedder.embedTexts).toHaveBeenCalledWith([
            "Meals\n\nMeals require a receipt.",
            "Mileage\n\nMileage is reimbursable.",
        ]);
        expect(repository.saveTenantPolicyChunkEmbedding).toHaveBeenCalledWith({
            id: pendingChunks[0]?.id,
            tenantId: tenantA,
            chunkHash: pendingChunks[0]?.chunkHash,
            embedding: [0.1],
            embeddingModel: "text-embedding-3-small",
        });
        expect(repository.saveTenantPolicyChunkEmbedding).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: tenantB, embedding: [0.2] }),
        );
        expect(summary).toEqual({
            embeddingModel: "text-embedding-3-small",
            pendingChunkCount: 2,
            embeddedChunkCount: 2,
            skippedChunkCount: 0,
        });
    });

    void test("scopes the pending query to one tenant when asked", async () => {
        const repository = {
            findPolicyChunksMissingEmbeddings: vi.fn().mockResolvedValue([]),
            saveTenantPolicyChunkEmbedding: vi.fn(),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn(),
        };

        const summary = await embedPolicyCorpus(
            { tenantId: tenantA },
            embedder,
            repository,
        );

        expect(
            repository.findPolicyChunksMissingEmbeddings,
        ).toHaveBeenCalledWith({
            tenantId: tenantA,
            embeddingModel: "text-embedding-3-small",
            limit: 1_000,
        });
        expect(embedder.embedTexts).not.toHaveBeenCalled();
        expect(summary.pendingChunkCount).toBe(0);
    });

    void test("counts a chunk as skipped when its text changed during embedding", async () => {
        const repository = {
            findPolicyChunksMissingEmbeddings: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantA, 0, "Meals", "Meals require a receipt."),
                ]),
            saveTenantPolicyChunkEmbedding: vi.fn().mockResolvedValue(false),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.1]]),
        };

        const summary = await embedPolicyCorpus({}, embedder, repository);

        expect(summary.embeddedChunkCount).toBe(0);
        expect(summary.skippedChunkCount).toBe(1);
    });

    void test("fails when the provider returns fewer vectors than chunks", async () => {
        const repository = {
            findPolicyChunksMissingEmbeddings: vi
                .fn()
                .mockResolvedValue([
                    chunk(tenantA, 0, "Meals", "Meals require a receipt."),
                    chunk(tenantA, 1, "Mileage", "Mileage is reimbursable."),
                ]),
            saveTenantPolicyChunkEmbedding: vi.fn(),
        };
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.1]]),
        };

        await expect(
            embedPolicyCorpus({}, embedder, repository),
        ).rejects.toThrow(PolicyEmbeddingServiceError);
        expect(
            repository.saveTenantPolicyChunkEmbedding,
        ).not.toHaveBeenCalled();
    });

    void test("rejects an invalid request shape", async () => {
        await expect(
            embedPolicyCorpus(
                { tenantId: "not-a-uuid" },
                { model: "text-embedding-3-small", embedTexts: vi.fn() },
                {
                    findPolicyChunksMissingEmbeddings: vi.fn(),
                    saveTenantPolicyChunkEmbedding: vi.fn(),
                },
            ),
        ).rejects.toThrow();
    });
});

void describe("embedPolicyQuery", () => {
    void test("returns the single query vector", async () => {
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([[0.5, 0.6]]),
        };

        await expect(
            embedPolicyQuery("are client dinners reimbursable", embedder),
        ).resolves.toEqual([0.5, 0.6]);
        expect(embedder.embedTexts).toHaveBeenCalledWith([
            "are client dinners reimbursable",
        ]);
    });

    void test("fails when the provider returns no vector", async () => {
        const embedder = {
            model: "text-embedding-3-small",
            embedTexts: vi.fn().mockResolvedValue([]),
        };

        await expect(embedPolicyQuery("meals", embedder)).rejects.toThrow(
            PolicyEmbeddingServiceError,
        );
    });
});

void describe("createOptionalPolicyEmbedder", () => {
    void test("returns undefined without embedding credentials", () => {
        expect(createOptionalPolicyEmbedder({})).toBeUndefined();
    });
});

void describe("embeddingInputForChunk", () => {
    void test("prefixes the section title so short clauses keep their topic", () => {
        expect(
            embeddingInputForChunk({
                section: "Meals",
                content: "Receipts are required.",
            }),
        ).toBe("Meals\n\nReceipts are required.");
    });
});
