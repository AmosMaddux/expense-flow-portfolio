import { describe, expect, test, vi } from "vitest";

import {
    loadExpensePolicyCorpus,
    type PolicyCorpusLoaderRepository,
} from "./policyCorpusLoaderService.js";

const tenantA = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const tenantB = "9e2bfbb1-9f72-4810-b8b1-a02a25cdd2fc";
const updatedAt = new Date("2026-08-20T12:00:00.000Z");

function policyCorpusLoadResult(
    request: Parameters<
        PolicyCorpusLoaderRepository["replaceTenantPolicyChunks"]
    >[0],
) {
    return {
        tenantId: request.tenantId,
        policyHash: request.policyHash,
        chunkCount: request.chunks.length,
        insertedCount: request.chunks.length,
        updatedCount: 0,
        deletedCount: 0,
        unchanged: false,
    };
}

function repository(): PolicyCorpusLoaderRepository {
    const replaceTenantPolicyChunks: PolicyCorpusLoaderRepository["replaceTenantPolicyChunks"] =
        (request) => Promise.resolve(policyCorpusLoadResult(request));

    return {
        findTenantPoliciesForCorpusLoad: vi.fn().mockResolvedValue([
            { tenantId: tenantA, policyText: "Policy A", updatedAt },
            { tenantId: tenantB, policyText: "Policy B", updatedAt },
        ]),
        replaceTenantPolicyChunks: vi.fn(replaceTenantPolicyChunks),
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

    void test("starts tenant loads in parallel and preserves result order", async () => {
        let resolveFirst!: () => void;
        let resolveSecond!: () => void;
        const firstFinished = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const secondFinished = new Promise<void>((resolve) => {
            resolveSecond = resolve;
        });
        const startedTenants: string[] = [];
        const testRepository = repository();
        const replaceTenantPolicyChunks: PolicyCorpusLoaderRepository["replaceTenantPolicyChunks"] =
            async (request) => {
                startedTenants.push(request.tenantId);
                await (request.tenantId === tenantA
                    ? firstFinished
                    : secondFinished);
                return policyCorpusLoadResult(request);
            };
        testRepository.replaceTenantPolicyChunks = vi.fn(
            replaceTenantPolicyChunks,
        );

        const loading = loadExpensePolicyCorpus({}, testRepository);
        await vi.waitFor(() => expect(startedTenants).toHaveLength(2));
        expect(startedTenants).toStrictEqual([tenantA, tenantB]);
        resolveFirst();
        resolveSecond();

        const result = await loading;
        expect(result.results.map((item) => item.tenantId)).toStrictEqual([
            tenantA,
            tenantB,
        ]);
    });
});
