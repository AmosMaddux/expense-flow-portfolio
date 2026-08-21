import { z } from "zod";

import {
    findTenantPoliciesForCorpusLoad,
    type TenantExpensePolicyRecord,
} from "./policyReferenceRepository.js";
import {
    chunkExpensePolicyCorpus,
    type ExpensePolicyChunk,
} from "./policyCorpusChunker.js";
import {
    replaceTenantPolicyChunks,
    type PolicyCorpusLoadResult,
} from "./policyCorpusRepository.js";

export const LoadExpensePolicyCorpusRequestSchema = z
    .object({
        tenantId: z.uuid().optional(),
    })
    .strict();

export type LoadExpensePolicyCorpusRequest = z.infer<
    typeof LoadExpensePolicyCorpusRequestSchema
>;

export type PolicyCorpusLoadSummary = {
    loadedTenantCount: number;
    results: PolicyCorpusLoadResult[];
};

export type PolicyCorpusLoaderRepository = {
    findTenantPoliciesForCorpusLoad: () => Promise<TenantExpensePolicyRecord[]>;
    replaceTenantPolicyChunks: (request: {
        tenantId: string;
        policyHash: string;
        chunks: ExpensePolicyChunk[];
    }) => Promise<PolicyCorpusLoadResult>;
};

const defaultPolicyCorpusLoaderRepository: PolicyCorpusLoaderRepository = {
    findTenantPoliciesForCorpusLoad,
    replaceTenantPolicyChunks,
};

/**
 * Loads tenant expense policies into tenant-scoped retrieval chunks.
 */
export async function loadExpensePolicyCorpus(
    request: LoadExpensePolicyCorpusRequest,
    repository: PolicyCorpusLoaderRepository = defaultPolicyCorpusLoaderRepository,
): Promise<PolicyCorpusLoadSummary> {
    const parsedRequest = LoadExpensePolicyCorpusRequestSchema.parse(request);
    const policies = await repository.findTenantPoliciesForCorpusLoad();
    const selectedPolicies = parsedRequest.tenantId
        ? policies.filter(
              (policy) => policy.tenantId === parsedRequest.tenantId,
          )
        : policies;
    const results = await Promise.all(
        selectedPolicies.map(async (policy) => {
            const chunks = chunkExpensePolicyCorpus({
                tenantId: policy.tenantId,
                policyText: policy.policyText,
                updatedAt: policy.updatedAt,
            });
            const [firstChunk] = chunks;
            if (firstChunk === undefined) {
                throw new Error(
                    `Expense policy for tenant ${policy.tenantId} produced no chunks.`,
                );
            }
            return repository.replaceTenantPolicyChunks({
                tenantId: policy.tenantId,
                policyHash: firstChunk.policyHash,
                chunks,
            });
        }),
    );

    return {
        loadedTenantCount: results.length,
        results,
    };
}
