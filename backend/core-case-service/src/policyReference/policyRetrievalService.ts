import { z } from "zod";

import {
    findTenantPolicyCorpusChunks,
    type TenantExpensePolicyChunkRecord,
} from "./policyCorpusRepository.js";

export const RetrievePolicyChunksRequestSchema = z
    .object({
        tenantId: z.uuid(),
        query: z.string().trim().min(1),
        topK: z.number().int().min(1).max(10).default(5),
    })
    .strict();

export type RetrievePolicyChunksRequest = z.infer<
    typeof RetrievePolicyChunksRequestSchema
>;

export const RetrievedPolicyChunkSchema = z
    .object({
        id: z.uuid(),
        tenantId: z.uuid(),
        policyHash: z.string().min(1),
        chunkHash: z.string().min(1),
        section: z.string().min(1),
        chunkIndex: z.number().int().nonnegative(),
        content: z.string().min(1),
        score: z.number().nonnegative(),
        citation: z.string().min(1),
    })
    .strict();

export type RetrievedPolicyChunk = z.infer<typeof RetrievedPolicyChunkSchema>;

export const RetrievePolicyChunksResponseSchema = z
    .object({
        chunks: z.array(RetrievedPolicyChunkSchema),
    })
    .strict();

export type RetrievePolicyChunksResponse = z.infer<
    typeof RetrievePolicyChunksResponseSchema
>;

export type PolicyRetrievalRepository = {
    findTenantPolicyCorpusChunks: (
        tenantId: string,
    ) => Promise<TenantExpensePolicyChunkRecord[]>;
};

const defaultPolicyRetrievalRepository: PolicyRetrievalRepository = {
    findTenantPolicyCorpusChunks,
};

const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "for",
    "from",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
]);

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length > 2 && !stopWords.has(token));
}

function normalizedPhrase(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim();
}

function scoreChunk(
    query: string,
    chunk: TenantExpensePolicyChunkRecord,
): number {
    const queryTokens = tokenize(query);
    const chunkTokens = tokenize(`${chunk.section} ${chunk.content}`);
    const sectionTokens = new Set(tokenize(chunk.section));
    const chunkTermFrequency = new Map<string, number>();

    for (const token of chunkTokens) {
        chunkTermFrequency.set(token, (chunkTermFrequency.get(token) ?? 0) + 1);
    }

    const uniqueQueryTokens = new Set(queryTokens);
    const matchedTokens = [...uniqueQueryTokens].filter((token) =>
        chunkTermFrequency.has(token),
    );
    const overlapScore =
        uniqueQueryTokens.size === 0
            ? 0
            : (matchedTokens.length / uniqueQueryTokens.size) * 10;
    const termFrequencyScore = matchedTokens.reduce(
        (total, token) =>
            total + Math.min(chunkTermFrequency.get(token) ?? 0, 3),
        0,
    );
    const sectionMatchScore =
        matchedTokens.filter((token) => sectionTokens.has(token)).length * 4;
    const phrase = normalizedPhrase(query);
    const contentPhrase = normalizedPhrase(`${chunk.section} ${chunk.content}`);
    const exactPhraseScore =
        phrase.length > 0 && contentPhrase.includes(phrase) ? 8 : 0;

    return (
        overlapScore + termFrequencyScore + sectionMatchScore + exactPhraseScore
    );
}

/**
 * Retrieves the most relevant policy chunks within one authenticated tenant's corpus.
 */
export async function retrievePolicyChunks(
    request: RetrievePolicyChunksRequest,
    repository: PolicyRetrievalRepository = defaultPolicyRetrievalRepository,
): Promise<RetrievePolicyChunksResponse> {
    const parsedRequest = RetrievePolicyChunksRequestSchema.parse(request);
    const chunks = await repository.findTenantPolicyCorpusChunks(
        parsedRequest.tenantId,
    );
    const rankedChunks = chunks
        .filter((chunk) => chunk.tenantId === parsedRequest.tenantId)
        .map((chunk, originalIndex) => ({
            chunk,
            originalIndex,
            score: scoreChunk(parsedRequest.query, chunk),
        }))
        .sort(
            (left, right) =>
                right.score - left.score ||
                left.chunk.chunkIndex - right.chunk.chunkIndex ||
                left.originalIndex - right.originalIndex,
        );
    const relevantChunks = rankedChunks.some((entry) => entry.score > 0)
        ? rankedChunks.filter((entry) => entry.score > 0)
        : rankedChunks;

    return {
        chunks: relevantChunks
            .slice(0, parsedRequest.topK)
            .map(({ chunk, score }) => ({
                id: chunk.id,
                tenantId: chunk.tenantId,
                policyHash: chunk.policyHash,
                chunkHash: chunk.chunkHash,
                section: chunk.section,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
                score,
                citation: `tenant_expense_policy:${chunk.policyHash}:chunk-${chunk.chunkIndex}`,
            })),
    };
}
