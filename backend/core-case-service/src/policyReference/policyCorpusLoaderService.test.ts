import { describe, expect, test, vi } from "vitest";

import {
    loadExpensePolicyCorpus,
    type PolicyCorpusLoaderRepository,
} from "./policyCorpusLoaderService.js";

const tenantA = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const tenantB = "9e2bfbb1-9f72-4810-b8b1-a02a25cdd2fc";
const updatedAt = new Date("2026-08-20T12:00:00.000Z");

function repository(): PolicyCorpusLoaderRepository {
    return {
        findTenantPoliciesForCorpusLoad: vi.fn().mockResolvedValue([
            { tenantId: tenantA, policyText: "Policy A", updatedAt },
            { tenantId: tenantB, policyText: "Policy B", updatedAt },
        ]),
        replaceTenantPolicyChunks: vi
            .fn()
            .mockImplementation(async (request) => ({
                tenantId: request.tenantId,
                policyHash: request.policyHash,
                chunkCount: request.chunks.length,
                insertedCount: request.chunks.length,
                updatedCount: 0,
                deletedCount: 0,
                unchanged: false,
            })),
    };
}

void describe("loadExpensePolicyCorpus", () => {
    void test("loads all tenant policies", async () => {
        const result = await loadExpensePolicyCorpus({}, repository());

        expect(result.loadedTenantCount).toBe(2);
        expect(result.results.map((item) => item.tenantId)).toStrictEqual([
            tenantA,
            tenantB,
        ]);
    });

    void test("loads only the requested tenant", async () => {
        const testRepository = repository();
        const result = await loadExpensePolicyCorpus(
            { tenantId: tenantB },
            testRepository,
        );

        expect(result.loadedTenantCount).toBe(1);
        expect(result.results[0]?.tenantId).toBe(tenantB);
        expect(testRepository.replaceTenantPolicyChunks).toHaveBeenCalledOnce();
    });
});
