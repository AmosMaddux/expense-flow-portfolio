import { and, eq, ne } from "drizzle-orm";

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
): Promise<PolicyCorpusLoadResult> {
    return db.transaction(async (transaction) => {
        const existingChunks = await transaction
            .select()
            .from(tenantExpensePolicyChunk)
            .where(eq(tenantExpensePolicyChunk.tenantId, request.tenantId));
        const currentChunks = existingChunks.filter(
            (chunk) => chunk.policyHash === request.policyHash,
        );

        if (
            currentChunks.length === request.chunks.length &&
            currentChunks.every((chunk) =>
                request.chunks.some(
                    (candidate) => candidate.chunkHash === chunk.chunkHash,
                ),
            )
        ) {
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
 * Reads policy chunks available to retrieval for one authenticated tenant.
 */
export async function findTenantPolicyCorpusChunks(
    tenantId: string,
): Promise<TenantExpensePolicyChunkRecord[]> {
    return db
        .select()
        .from(tenantExpensePolicyChunk)
        .where(eq(tenantExpensePolicyChunk.tenantId, tenantId));
}

export type TenantExpensePolicyChunkRecord = TenantExpensePolicyChunk;
