import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { TenantExpensePolicyChunkRecord } from "../policyCorpusRepository.js";
import { embeddingInputForChunk } from "../policyEmbeddingService.js";
import type { PolicyEmbedder } from "../policyEmbeddingService.js";
import type { PolicyRetrievalRepository } from "../policyRetrievalService.js";

import { cosineSimilarity } from "./deterministicEmbedder.js";

const PolicySectionSchema = z
    .object({
        section: z.string().min(1),
        content: z.string().min(1),
    })
    .strict();

const EvaluationCorpusSchema = z
    .object({
        description: z.string().min(1),
        tenants: z
            .array(
                z
                    .object({
                        tenantId: z.uuid(),
                        name: z.string().min(1),
                        policyHash: z.string().min(1),
                        sections: z.array(PolicySectionSchema).min(1),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

export type EvaluationCorpus = z.infer<typeof EvaluationCorpusSchema>;
export type EvaluationPolicySection = z.infer<typeof PolicySectionSchema>;

/**
 * Reads the fixed evaluation corpus from disk.
 *
 * The evaluation corpus is synthetic and version controlled, so the gate scores
 * the retrieval pipeline rather than whatever happens to be in a database.
 */
export async function readEvaluationCorpus(
    corpusPath: string,
): Promise<EvaluationCorpus> {
    const raw: unknown = JSON.parse(await readFile(corpusPath, "utf8"));

    return EvaluationCorpusSchema.parse(raw);
}

/**
 * Builds tenant-scoped chunk records from the evaluation corpus.
 *
 * `extraSections` appends sections to one tenant, which is how a poisoned
 * corpus case plants an injected instruction inside retrievable policy text.
 */
export function buildEvaluationChunks(
    corpus: EvaluationCorpus,
    extraSections: ReadonlyMap<
        string,
        readonly EvaluationPolicySection[]
    > = new Map(),
): TenantExpensePolicyChunkRecord[] {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    return corpus.tenants.flatMap((tenant) =>
        [...tenant.sections, ...(extraSections.get(tenant.tenantId) ?? [])].map(
            (section, chunkIndex) => ({
                id: deterministicChunkId(tenant.tenantId, chunkIndex),
                tenantId: tenant.tenantId,
                policyHash: tenant.policyHash,
                chunkHash: sha256(
                    `${tenant.tenantId}:${String(chunkIndex)}:${section.content}`,
                ),
                section: section.section,
                chunkIndex,
                content: `${section.section}\n${section.content}`,
                metadata: {
                    tenantId: tenant.tenantId,
                    section: section.section,
                    source: "evaluation_corpus",
                },
                embedding: null,
                embeddingModel: null,
                embeddedAt: null,
                createdAt: timestamp,
                updatedAt: timestamp,
            }),
        ),
    );
}

/**
 * Embeds every chunk with the supplied embedder.
 *
 * Chunks are embedded through `embeddingInputForChunk`, the same function the
 * production loader uses, so the evaluation vectors are built from the same
 * text the real corpus would embed.
 */
export async function embedEvaluationChunks(
    chunks: readonly TenantExpensePolicyChunkRecord[],
    embedder: PolicyEmbedder,
): Promise<TenantExpensePolicyChunkRecord[]> {
    const vectors = await embedder.embedTexts(
        chunks.map((chunk) => embeddingInputForChunk(chunk)),
    );

    return chunks.map((chunk, index) => ({
        ...chunk,
        embedding: vectors[index] ?? null,
        embeddingModel: embedder.model,
        embeddedAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
}

/**
 * Returns a retrieval repository backed by the evaluation corpus.
 *
 * Similarity search ranks by real cosine similarity over the chunk vectors and
 * applies the same tenant and embedding-model predicates the SQL repository
 * applies, so the gate exercises vector retrieval rather than assuming it. A
 * corpus with no vectors degrades to lexical-only ranking, which is the same
 * behaviour retrieval has when no embedding provider is configured.
 */
export function createEvaluationRetrievalRepository(
    chunks: readonly TenantExpensePolicyChunkRecord[],
): PolicyRetrievalRepository {
    return {
        findTenantPolicyCorpusChunks: (tenantId) =>
            Promise.resolve(
                chunks.filter((chunk) => chunk.tenantId === tenantId),
            ),
        findSimilarTenantPolicyChunks: (request) =>
            Promise.resolve(
                chunks
                    .filter(
                        (chunk) =>
                            chunk.tenantId === request.tenantId &&
                            chunk.embedding !== null &&
                            chunk.embeddingModel === request.embeddingModel,
                    )
                    .map((chunk) => ({
                        ...chunk,
                        similarity: cosineSimilarity(
                            chunk.embedding ?? [],
                            request.embedding,
                        ),
                    }))
                    .sort((left, right) => right.similarity - left.similarity)
                    .slice(0, request.limit),
            ),
    };
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicChunkId(tenantId: string, chunkIndex: number): string {
    const digest = sha256(`${tenantId}:${String(chunkIndex)}`);
    const hex = digest.slice(0, 32);

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `4${hex.slice(13, 16)}`,
        `8${hex.slice(17, 20)}`,
        hex.slice(20, 32),
    ].join("-");
}
