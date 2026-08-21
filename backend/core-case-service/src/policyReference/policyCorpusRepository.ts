import { and, cosineDistance, eq, isNotNull, ne, or, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import {
    tenantExpensePolicyChunk,
    type TenantExpensePolicyChunk,
} from "../db/schema/index.js";
import type { ExpensePolicyChunk } from "./policyCorpusChunker.js";

export type ReplaceTenantPolicyChunksRequest = {
    tenantId: string;
    policyHash: string;
    chunks: ExpensePolicyChunk[];
    /** Chunk embeddings keyed by `chunkHash`, when an embedding provider ran. */
    embeddings?: ReadonlyMap<string, number[]>;
    embeddingModel?: string;
};

export type PolicyCorpusLoadResult = {
    tenantId: string;
    policyHash: string;
    chunkCount: number;
    insertedCount: number;
    updatedCount: number;
    deletedCount: number;
    unchanged: boolean;
};

/**
 * Replaces one tenant's policy chunks idempotently inside a database transaction.
 */
export async function replaceTenantPolicyChunks(
    request: ReplaceTenantPolicyChunksRequest,
    database: Pick<typeof db, "transaction"> = db,
): Promise<PolicyCorpusLoadResult> {
    return database.transaction(async (transaction) => {
        const existingChunks = await transaction
            .select()
            .from(tenantExpensePolicyChunk)
            .where(eq(tenantExpensePolicyChunk.tenantId, request.tenantId));
        const currentChunks = existingChunks.filter(
            (chunk) => chunk.policyHash === request.policyHash,
        );

        // Unchanged text is not enough to skip the write. A corpus loaded before
        // an embedding provider was configured holds the same chunks with no
        // vectors, so returning early on text alone would leave those chunks
        // permanently unembedded while reporting success.
        const textUnchanged =
            currentChunks.length === request.chunks.length &&
            currentChunks.every((chunk) =>
                request.chunks.some(
                    (candidate) => candidate.chunkHash === chunk.chunkHash,
                ),
            );

        if (textUnchanged && !hasPendingEmbeddings(request, currentChunks)) {
            return {
                tenantId: request.tenantId,
                policyHash: request.policyHash,
                chunkCount: request.chunks.length,
                insertedCount: 0,
                updatedCount: 0,
                deletedCount: 0,
                unchanged: true,
            };
        }

        const existingByIndex = new Map(
            currentChunks.map((chunk) => [chunk.chunkIndex, chunk]),
        );
        let insertedCount = 0;
        let updatedCount = 0;

        for (const chunk of request.chunks) {
            const existing = existingByIndex.get(chunk.chunkIndex);
            if (existing === undefined) {
                insertedCount += 1;
            } else if (
                existing.chunkHash !== chunk.chunkHash ||
                existing.content !== chunk.content
            ) {
                updatedCount += 1;
            }

            const embedding = resolveChunkEmbedding(request, chunk, existing);

            await transaction
                .insert(tenantExpensePolicyChunk)
                .values({
                    tenantId: request.tenantId,
                    policyHash: request.policyHash,
                    chunkHash: chunk.chunkHash,
                    section: chunk.section,
                    chunkIndex: chunk.chunkIndex,
                    content: chunk.content,
                    metadata: chunk.metadata,
                    embedding: embedding.embedding,
                    embeddingModel: embedding.embeddingModel,
                    embeddedAt: embedding.embeddedAt,
                })
                .onConflictDoUpdate({
                    target: [
                        tenantExpensePolicyChunk.tenantId,
                        tenantExpensePolicyChunk.policyHash,
                        tenantExpensePolicyChunk.chunkIndex,
                    ],
                    set: {
                        chunkHash: chunk.chunkHash,
                        section: chunk.section,
                        content: chunk.content,
                        metadata: chunk.metadata,
                        embedding: embedding.embedding,
                        embeddingModel: embedding.embeddingModel,
                        embeddedAt: embedding.embeddedAt,
                        updatedAt: new Date(),
                    },
                });
        }

        const deleted = await transaction
            .delete(tenantExpensePolicyChunk)
            .where(
                and(
                    eq(tenantExpensePolicyChunk.tenantId, request.tenantId),
                    ne(tenantExpensePolicyChunk.policyHash, request.policyHash),
                ),
            )
            .returning({ id: tenantExpensePolicyChunk.id });

        return {
            tenantId: request.tenantId,
            policyHash: request.policyHash,
            chunkCount: request.chunks.length,
            insertedCount,
            updatedCount,
            deletedCount: deleted.length,
            unchanged: false,
        };
    });
}

/**
 * Reports whether this load carries embeddings the stored chunks do not have.
 *
 * A supplied vector is pending when the stored chunk has none, or has one from
 * a different model, because vectors from two models are not interchangeable.
 */
function hasPendingEmbeddings(
    request: ReplaceTenantPolicyChunksRequest,
    currentChunks: readonly TenantExpensePolicyChunk[],
): boolean {
    if (
        request.embeddings === undefined ||
        request.embeddingModel === undefined
    ) {
        return false;
    }

    const storedByChunkHash = new Map(
        currentChunks.map((chunk) => [chunk.chunkHash, chunk]),
    );

    return request.chunks.some((chunk) => {
        if (!request.embeddings?.has(chunk.chunkHash)) {
            return false;
        }

        const stored = storedByChunkHash.get(chunk.chunkHash);

        return (
            stored === undefined ||
            stored.embedding === null ||
            stored.embeddingModel !== request.embeddingModel
        );
    });
}

type ChunkEmbeddingColumns = {
    embedding: number[] | null;
    embeddingModel: string | null;
    embeddedAt: Date | null;
};

/**
 * Decides which embedding a chunk row keeps when the corpus is reloaded.
 *
 * A chunk whose text changed must not keep the vector of its previous text, and
 * a chunk whose text is unchanged must not lose an embedding just because this
 * load ran without an embedding provider.
 */
function resolveChunkEmbedding(
    request: ReplaceTenantPolicyChunksRequest,
    chunk: ExpensePolicyChunk,
    existing: TenantExpensePolicyChunk | undefined,
): ChunkEmbeddingColumns {
    const embedding = request.embeddings?.get(chunk.chunkHash);
    if (embedding !== undefined && request.embeddingModel !== undefined) {
        return {
            embedding,
            embeddingModel: request.embeddingModel,
            embeddedAt: new Date(),
        };
    }

    if (existing?.chunkHash === chunk.chunkHash) {
        return {
            embedding: existing.embedding,
            embeddingModel: existing.embeddingModel,
            embeddedAt: existing.embeddedAt,
        };
    }

    return { embedding: null, embeddingModel: null, embeddedAt: null };
}

export type FindPolicyChunksMissingEmbeddingsRequest = {
    tenantId?: string;
    embeddingModel: string;
    limit: number;
};

/**
 * Reads chunks that still need an embedding for the configured model.
 */
export async function findPolicyChunksMissingEmbeddings(
    request: FindPolicyChunksMissingEmbeddingsRequest,
    database: Pick<typeof db, "select"> = db,
): Promise<TenantExpensePolicyChunkRecord[]> {
    const staleEmbedding = or(
        sql`${tenantExpensePolicyChunk.embedding} is null`,
        ne(tenantExpensePolicyChunk.embeddingModel, request.embeddingModel),
    );

    return database
        .select()
        .from(tenantExpensePolicyChunk)
        .where(
            request.tenantId === undefined
                ? staleEmbedding
                : and(
                      eq(tenantExpensePolicyChunk.tenantId, request.tenantId),
                      staleEmbedding,
                  ),
        )
        .orderBy(
            tenantExpensePolicyChunk.tenantId,
            tenantExpensePolicyChunk.chunkIndex,
        )
        .limit(request.limit);
}

export type SaveChunkEmbeddingRequest = {
    id: string;
    tenantId: string;
    chunkHash: string;
    embedding: number[];
    embeddingModel: string;
};

/**
 * Stores one chunk embedding, scoped to the owning tenant.
 *
 * The `chunkHash` predicate drops the write when a corpus reload replaced the
 * chunk text while the embedding was in flight, so no vector is ever attached
 * to text it was not generated from.
 */
export async function saveTenantPolicyChunkEmbedding(
    request: SaveChunkEmbeddingRequest,
    database: Pick<typeof db, "update"> = db,
): Promise<boolean> {
    const updated = await database
        .update(tenantExpensePolicyChunk)
        .set({
            embedding: request.embedding,
            embeddingModel: request.embeddingModel,
            embeddedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(tenantExpensePolicyChunk.id, request.id),
                eq(tenantExpensePolicyChunk.tenantId, request.tenantId),
                eq(tenantExpensePolicyChunk.chunkHash, request.chunkHash),
            ),
        )
        .returning({ id: tenantExpensePolicyChunk.id });

    return updated.length > 0;
}

export type FindSimilarPolicyChunksRequest = {
    tenantId: string;
    embedding: number[];
    embeddingModel: string;
    limit: number;
};

export type SimilarPolicyChunkRecord = TenantExpensePolicyChunk & {
    similarity: number;
};

/**
 * Ranks one tenant's embedded policy chunks by cosine similarity to a query
 * vector.
 *
 * The tenant predicate is applied in SQL so the HNSW index never returns
 * another tenant's chunks into retrieval.
 *
 * The model predicate is applied for the same reason the backfill treats a
 * different model as stale: vectors from two models occupy unrelated spaces, so
 * comparing them produces a meaningless distance. During a model migration the
 * corpus holds both, and only this filter keeps the old space out of ranking.
 */
export async function findSimilarTenantPolicyChunks(
    request: FindSimilarPolicyChunksRequest,
    database: Pick<typeof db, "select"> = db,
): Promise<SimilarPolicyChunkRecord[]> {
    const similarity = sql<number>`1 - (${cosineDistance(tenantExpensePolicyChunk.embedding, request.embedding)})`;

    return database
        .select({
            id: tenantExpensePolicyChunk.id,
            tenantId: tenantExpensePolicyChunk.tenantId,
            policyHash: tenantExpensePolicyChunk.policyHash,
            chunkHash: tenantExpensePolicyChunk.chunkHash,
            section: tenantExpensePolicyChunk.section,
            chunkIndex: tenantExpensePolicyChunk.chunkIndex,
            content: tenantExpensePolicyChunk.content,
            metadata: tenantExpensePolicyChunk.metadata,
            embedding: tenantExpensePolicyChunk.embedding,
            embeddingModel: tenantExpensePolicyChunk.embeddingModel,
            embeddedAt: tenantExpensePolicyChunk.embeddedAt,
            createdAt: tenantExpensePolicyChunk.createdAt,
            updatedAt: tenantExpensePolicyChunk.updatedAt,
            similarity,
        })
        .from(tenantExpensePolicyChunk)
        .where(
            and(
                eq(tenantExpensePolicyChunk.tenantId, request.tenantId),
                isNotNull(tenantExpensePolicyChunk.embedding),
                eq(
                    tenantExpensePolicyChunk.embeddingModel,
                    request.embeddingModel,
                ),
            ),
        )
        .orderBy(
            cosineDistance(
                tenantExpensePolicyChunk.embedding,
                request.embedding,
            ),
        )
        .limit(request.limit);
}

/**
 * Reads policy chunks available to retrieval for one authenticated tenant.
 */
export async function findTenantPolicyCorpusChunks(
    tenantId: string,
    database: Pick<typeof db, "select"> = db,
): Promise<TenantExpensePolicyChunkRecord[]> {
    return database
        .select()
        .from(tenantExpensePolicyChunk)
        .where(eq(tenantExpensePolicyChunk.tenantId, tenantId));
}

export type TenantExpensePolicyChunkRecord = TenantExpensePolicyChunk;
