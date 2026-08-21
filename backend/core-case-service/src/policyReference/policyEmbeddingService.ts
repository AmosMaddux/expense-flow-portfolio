import { z } from "zod";

import {
    isPolicyEmbeddingConfigured,
    loadDefaultPolicyEmbeddingConfig,
    type PolicyEmbeddingConfig,
} from "../config/policyEmbeddingConfig.js";

import { createPolicyEmbeddings } from "./policyEmbeddingClient.js";
import { PolicyEmbeddingServiceError } from "./policyEmbeddingErrors.js";
import {
    findPolicyChunksMissingEmbeddings,
    saveTenantPolicyChunkEmbedding,
    type TenantExpensePolicyChunkRecord,
} from "./policyCorpusRepository.js";

export const EmbedPolicyCorpusRequestSchema = z
    .object({
        tenantId: z.uuid().optional(),
        maxChunks: z.number().int().positive().max(10_000).default(1_000),
    })
    .strict();

export type EmbedPolicyCorpusRequest = z.input<
    typeof EmbedPolicyCorpusRequestSchema
>;

export type EmbedPolicyCorpusSummary = {
    embeddingModel: string;
    pendingChunkCount: number;
    embeddedChunkCount: number;
    skippedChunkCount: number;
};

export type PolicyEmbedder = {
    model: string;
    embedTexts: (texts: string[]) => Promise<number[][]>;
};

export type PolicyEmbeddingRepository = {
    findPolicyChunksMissingEmbeddings: (request: {
        tenantId?: string;
        embeddingModel: string;
        limit: number;
    }) => Promise<TenantExpensePolicyChunkRecord[]>;
    saveTenantPolicyChunkEmbedding: (request: {
        id: string;
        tenantId: string;
        chunkHash: string;
        embedding: number[];
        embeddingModel: string;
    }) => Promise<boolean>;
};

const defaultPolicyEmbeddingRepository: PolicyEmbeddingRepository = {
    findPolicyChunksMissingEmbeddings: async (request) =>
        findPolicyChunksMissingEmbeddings(request),
    saveTenantPolicyChunkEmbedding,
};

/**
 * Builds an embedder bound to the configured OpenAI embedding model.
 */
export function createPolicyEmbedder(
    config: PolicyEmbeddingConfig = loadDefaultPolicyEmbeddingConfig(),
): PolicyEmbedder {
    return {
        model: config.POLICY_EMBEDDING_MODEL,
        embedTexts: async (texts: string[]) =>
            embedInBatches(texts, config, config.POLICY_EMBEDDING_BATCH_SIZE),
    };
}

/**
 * Returns an embedder only when the process has embedding credentials.
 *
 * Callers that must keep working without an embedding provider use this and
 * fall back to lexical-only behaviour when it returns `undefined`.
 */
export function createOptionalPolicyEmbedder(
    environment: NodeJS.ProcessEnv = process.env,
): PolicyEmbedder | undefined {
    if (!isPolicyEmbeddingConfigured(environment)) {
        return undefined;
    }

    try {
        return createPolicyEmbedder();
    } catch {
        return undefined;
    }
}

async function embedInBatches(
    texts: string[],
    config: PolicyEmbeddingConfig,
    batchSize: number,
): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const result = await createPolicyEmbeddings(
            {
                input: batch,
                model: config.POLICY_EMBEDDING_MODEL,
                dimensions: config.POLICY_EMBEDDING_DIMENSIONS,
            },
            {
                apiKey: config.POLICY_EMBEDDING_API_KEY,
                baseUrl: config.POLICY_EMBEDDING_BASE_URL,
                baseBackoffMs: config.POLICY_EMBEDDING_BASE_BACKOFF_MS,
                maxBackoffMs: config.POLICY_EMBEDDING_MAX_BACKOFF_MS,
                maxRetries: config.POLICY_EMBEDDING_MAX_RETRIES,
                timeoutMs: config.POLICY_EMBEDDING_TIMEOUT_MS,
            },
        );
        embeddings.push(...result.embeddings);
    }

    return embeddings;
}

/**
 * Embeds one query string for tenant-scoped similarity search.
 */
export async function embedPolicyQuery(
    query: string,
    embedder: PolicyEmbedder,
): Promise<number[]> {
    const [embedding] = await embedder.embedTexts([query]);
    if (embedding === undefined) {
        throw new PolicyEmbeddingServiceError(
            "The policy embedding provider returned no query vector.",
        );
    }

    return embedding;
}

/**
 * Embeds stored policy chunks that have no vector for the configured model.
 */
export async function embedPolicyCorpus(
    request: EmbedPolicyCorpusRequest = {},
    embedder: PolicyEmbedder = createPolicyEmbedder(),
    repository: PolicyEmbeddingRepository = defaultPolicyEmbeddingRepository,
): Promise<EmbedPolicyCorpusSummary> {
    const parsedRequest = EmbedPolicyCorpusRequestSchema.parse(request);
    const pendingChunks = await repository.findPolicyChunksMissingEmbeddings({
        ...(parsedRequest.tenantId === undefined
            ? {}
            : { tenantId: parsedRequest.tenantId }),
        embeddingModel: embedder.model,
        limit: parsedRequest.maxChunks,
    });

    if (pendingChunks.length === 0) {
        return {
            embeddingModel: embedder.model,
            pendingChunkCount: 0,
            embeddedChunkCount: 0,
            skippedChunkCount: 0,
        };
    }

    const embeddings = await embedder.embedTexts(
        pendingChunks.map((chunk) => embeddingInputForChunk(chunk)),
    );
    if (embeddings.length !== pendingChunks.length) {
        throw new PolicyEmbeddingServiceError(
            "The policy embedding provider returned a different number of vectors than chunks.",
        );
    }

    let embeddedChunkCount = 0;
    let skippedChunkCount = 0;
    for (const [index, chunk] of pendingChunks.entries()) {
        const embedding = embeddings[index];
        if (embedding === undefined) {
            skippedChunkCount += 1;
            continue;
        }

        const saved = await repository.saveTenantPolicyChunkEmbedding({
            id: chunk.id,
            tenantId: chunk.tenantId,
            chunkHash: chunk.chunkHash,
            embedding,
            embeddingModel: embedder.model,
        });
        if (saved) {
            embeddedChunkCount += 1;
        } else {
            skippedChunkCount += 1;
        }
    }

    return {
        embeddingModel: embedder.model,
        pendingChunkCount: pendingChunks.length,
        embeddedChunkCount,
        skippedChunkCount,
    };
}

/**
 * Builds the text embedded for a chunk.
 *
 * The section title is prepended so a chunk keeps its topic when its body text
 * alone is ambiguous, which matters for short policy clauses.
 */
export function embeddingInputForChunk(chunk: {
    section: string;
    content: string;
}): string {
    return `${chunk.section}\n\n${chunk.content}`;
}
