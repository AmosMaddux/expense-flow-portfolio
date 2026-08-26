import { z } from "zod";

import {
    findGuardrailViolations,
    primaryGuardrailCategory,
    refusalMessageFor,
    type GuardrailCategory,
} from "./policyAssistantGuardrails.js";
import {
    leaksSystemPrompt,
    policyAssistantSystemPrompt,
} from "./policyAssistantPrompt.js";
import {
    retrievePolicyChunks,
    type RetrievedPolicyChunk,
} from "./policyRetrievalService.js";

export const AnswerPolicyQuestionRequestSchema = z
    .object({
        tenantId: z.uuid(),
        question: z.string().trim().min(1).max(2_000),
        topK: z.number().int().min(1).max(10).default(4),
        retrievalHints: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
    })
    .strict();

export type AnswerPolicyQuestionRequest = z.input<
    typeof AnswerPolicyQuestionRequestSchema
>;

export const PolicyAnswerContextSchema = z
    .object({
        citation: z.string().min(1),
        section: z.string().min(1),
        content: z.string().min(1),
        score: z.number(),
    })
    .strict();

export type PolicyAnswerContext = z.infer<typeof PolicyAnswerContextSchema>;

export const PolicyAnswerSchema = z
    .object({
        tenantId: z.uuid(),
        question: z.string().min(1),
        answer: z.string().min(1),
        citations: z.array(z.string().min(1)),
        contexts: z.array(PolicyAnswerContextSchema),
        refused: z.boolean(),
        abstained: z.boolean(),
        refusalCategory: z
            .enum(["prompt_disclosure", "cross_tenant", "instruction_override"])
            .nullable(),
    })
    .strict();

export type PolicyAnswer = z.infer<typeof PolicyAnswerSchema>;

export type PolicyChunkRetriever = (request: {
    tenantId: string;
    query: string;
    topK: number;
}) => Promise<{ chunks: RetrievedPolicyChunk[] }>;

const defaultRetriever: PolicyChunkRetriever = async (request) =>
    retrievePolicyChunks(request);

const maxAnswerSentences = 4;
const noAnswerText =
    "I couldn't find anything in your workspace's expense policy that answers that.";

/**
 * Answers a policy question from one authenticated tenant's policy corpus.
 *
 * The answer is composed extractively from retrieved chunks, so every sentence
 * is traceable to cited policy text and the assistant cannot invent policy.
 * Guardrails run before retrieval, and again over the retrieved text, so an
 * instruction planted inside a policy chunk is never followed. The composed
 * answer is checked for system prompt leakage before it is returned.
 */
export async function answerPolicyQuestion(
    request: AnswerPolicyQuestionRequest,
    retriever: PolicyChunkRetriever = defaultRetriever,
): Promise<PolicyAnswer> {
    const parsedRequest = AnswerPolicyQuestionRequestSchema.parse(request);
    const questionCategory = primaryGuardrailCategory(
        findGuardrailViolations(parsedRequest.question),
    );
    if (questionCategory !== undefined) {
        return refusal(
            parsedRequest.tenantId,
            parsedRequest.question,
            questionCategory,
        );
    }

    const { chunks } = await retriever({
        tenantId: parsedRequest.tenantId,
        query: [parsedRequest.question, ...parsedRequest.retrievalHints].join(" "),
        topK: parsedRequest.topK,
    });
    // Retrieval already filters by tenant; this repeats the check so a future
    // retriever swap cannot widen the tenant boundary unnoticed.
    const tenantChunks = chunks.filter(
        (chunk) => chunk.tenantId === parsedRequest.tenantId,
    );
    const contexts = tenantChunks.map((chunk) => ({
        citation: chunk.citation,
        section: chunk.section,
        content: chunk.content,
        score: chunk.score,
    }));
    const selected = selectAnswerSentences(
        parsedRequest.question,
        tenantChunks,
    );

    if (selected.length === 0) {
        return {
            tenantId: parsedRequest.tenantId,
            question: parsedRequest.question,
            answer: noAnswerText,
            citations: [],
            contexts,
            refused: false,
            abstained: true,
            refusalCategory: null,
        };
    }

    const citations = [...new Set(selected.map((entry) => entry.citation))];
    const answer = `${selected.map((entry) => entry.sentence).join(" ")} (${citations.join(", ")})`;

    if (leaksSystemPrompt(answer)) {
        return refusal(
            parsedRequest.tenantId,
            parsedRequest.question,
            "prompt_disclosure",
        );
    }

    return {
        tenantId: parsedRequest.tenantId,
        question: parsedRequest.question,
        answer,
        citations,
        contexts,
        refused: false,
        abstained: false,
        refusalCategory: null,
    };
}

/**
 * Returns the system prompt that configures the assistant.
 *
 * Exposed for tests and evaluation only. It is never included in an answer.
 */
export function policyAssistantPrompt(): string {
    return policyAssistantSystemPrompt;
}

function refusal(
    tenantId: string,
    question: string,
    category: GuardrailCategory,
): PolicyAnswer {
    return {
        tenantId,
        question,
        answer: refusalMessageFor(category),
        citations: [],
        contexts: [],
        refused: true,
        abstained: false,
        refusalCategory: category,
    };
}

type SelectedSentence = {
    citation: string;
    sentence: string;
    chunkRank: number;
    sentenceIndex: number;
    overlap: number;
};

const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "can",
    "do",
    "does",
    "for",
    "from",
    "how",
    "in",
    "is",
    "it",
    "may",
    "much",
    "my",
    "of",
    "on",
    "or",
    "our",
    "the",
    "to",
    "we",
    "what",
    "when",
    "which",
    "who",
    "why",
    "with",
]);

function contentTokens(value: string): Set<string> {
    return new Set(
        value
            .toLowerCase()
            .split(/[^a-z0-9]+/u)
            .filter((token) => token.length > 2 && !stopWords.has(token)),
    );
}

function splitSentences(value: string): string[] {
    return value
        .split(/(?<=[.!?])\s+|\n+/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}

/**
 * Reports whether a line is a section heading rather than a policy statement.
 *
 * Chunk text carries its section title, which matches question terms strongly
 * but states no policy, so quoting it would pad the answer without answering.
 */
function isHeading(sentence: string): boolean {
    return !/[.!?]$/u.test(sentence) && sentence.split(/\s+/u).length <= 8;
}

/**
 * Picks the sentences that answer the question from the retrieved chunks.
 *
 * A sentence that trips a guardrail is dropped rather than quoted, so policy
 * text carrying an injected instruction cannot reach the answer.
 */
function selectAnswerSentences(
    question: string,
    chunks: readonly RetrievedPolicyChunk[],
): SelectedSentence[] {
    const questionTokens = contentTokens(question);
    const candidates: SelectedSentence[] = [];

    for (const [chunkRank, chunk] of chunks.entries()) {
        for (const [sentenceIndex, sentence] of splitSentences(
            chunk.content,
        ).entries()) {
            if (
                isHeading(sentence) ||
                findGuardrailViolations(sentence).length > 0
            ) {
                continue;
            }

            const sentenceTokens = contentTokens(sentence);
            const overlap = [...questionTokens].filter((token) =>
                sentenceTokens.has(token),
            ).length;
            if (overlap === 0) {
                continue;
            }

            candidates.push({
                citation: chunk.citation,
                sentence,
                chunkRank,
                sentenceIndex,
                overlap,
            });
        }
    }

    if (candidates.length === 0) {
        return leadingSentencesOfBestChunk(chunks);
    }

    return candidates
        .sort(
            (left, right) =>
                right.overlap - left.overlap ||
                left.chunkRank - right.chunkRank ||
                left.sentenceIndex - right.sentenceIndex,
        )
        .slice(0, maxAnswerSentences)
        .sort(
            (left, right) =>
                left.chunkRank - right.chunkRank ||
                left.sentenceIndex - right.sentenceIndex,
        );
}

/**
 * Falls back to the highest ranked chunk when no sentence shares a term with
 * the question.
 *
 * A paraphrased question ("snacks from the hotel fridge") can retrieve the
 * right section while sharing no vocabulary with it. Quoting the top-ranked
 * section is still grounded and cited, and is more useful than abstaining.
 */
function leadingSentencesOfBestChunk(
    chunks: readonly RetrievedPolicyChunk[],
): SelectedSentence[] {
    const [bestChunk] = chunks;
    if (bestChunk === undefined || bestChunk.score <= 0) {
        return [];
    }

    return splitSentences(bestChunk.content)
        .filter(
            (sentence) =>
                !isHeading(sentence) &&
                findGuardrailViolations(sentence).length === 0,
        )
        .slice(0, maxAnswerSentences)
        .map((sentence, sentenceIndex) => ({
            citation: bestChunk.citation,
            sentence,
            chunkRank: 0,
            sentenceIndex,
            overlap: 0,
        }));
}
