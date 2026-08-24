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
import {
    createOptionalPolicyEmbedder,
    embeddingInputForChunk,
    type PolicyEmbedder,
} from "./policyEmbeddingService.js";

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
    embeddedTenantCount: number;
    results: PolicyCorpusLoadResult[];
};

export type PolicyCorpusLoaderRepository = {
    findTenantPoliciesForCorpusLoad: () => Promise<TenantExpensePolicyRecord[]>;
    replaceTenantPolicyChunks: (request: {
        tenantId: string;
        policyHash: string;
        chunks: ExpensePolicyChunk[];
        embeddings?: ReadonlyMap<string, number[]>;
        embeddingModel?: string;
    }) => Promise<PolicyCorpusLoadResult>;
};

const defaultPolicyCorpusLoaderRepository: PolicyCorpusLoaderRepository = {
    findTenantPoliciesForCorpusLoad,
    replaceTenantPolicyChunks,
};

/**
 * Loads tenant expense policies into tenant-scoped retrieval chunks.
 *
 * Chunks are embedded during the load when an embedding provider is
 * configured. A provider failure is not fatal: the chunks are still persisted
 * without vectors and can be embedded later by the corpus embedding command.
 */
export async function loadExpensePolicyCorpus(
    request: LoadExpensePolicyCorpusRequest,
    repository: PolicyCorpusLoaderRepository = defaultPolicyCorpusLoaderRepository,
    embedder: PolicyEmbedder | undefined = createOptionalPolicyEmbedder(),
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
            const embeddings = await embedChunks(chunks, embedder);
            const result = await repository.replaceTenantPolicyChunks({
                tenantId: policy.tenantId,
                policyHash: firstChunk.policyHash,
                chunks,
                ...(embeddings === undefined || embedder === undefined
                    ? {}
                    : { embeddings, embeddingModel: embedder.model }),
            });

            return { result, embedded: embeddings !== undefined };
        }),
    );

    return {
        loadedTenantCount: results.length,
        embeddedTenantCount: results.filter((entry) => entry.embedded).length,
        results: results.map((entry) => entry.result),
    };
}

async function embedChunks(
    chunks: ExpensePolicyChunk[],
    embedder: PolicyEmbedder | undefined,
): Promise<ReadonlyMap<string, number[]> | undefined> {
    if (embedder === undefined) {
        return undefined;
    }

    try {
        const embeddings = await embedder.embedTexts(
            chunks.map((chunk) => embeddingInputForChunk(chunk)),
        );
        if (embeddings.length !== chunks.length) {
            return undefined;
        }

        const embeddingsByChunkHash = new Map<string, number[]>();
        for (const [index, chunk] of chunks.entries()) {
            const embedding = embeddings[index];
            if (embedding !== undefined) {
                embeddingsByChunkHash.set(chunk.chunkHash, embedding);
            }
        }

        return embeddingsByChunkHash;
    } catch {
        return undefined;
    }
}
