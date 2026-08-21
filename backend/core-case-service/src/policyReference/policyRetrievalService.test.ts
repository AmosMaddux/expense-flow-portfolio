import { describe, expect, test, vi } from "vitest";

import type { TenantExpensePolicyChunkRecord } from "./policyCorpusRepository.js";
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
        createdAt: new Date("2026-08-20T12:00:00.000Z"),
        updatedAt: new Date("2026-08-20T12:00:00.000Z"),
    };
}

void describe("retrievePolicyChunks", () => {
    void test("ranks the most relevant meals and receipt chunk first", async () => {
        const repository = {
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
