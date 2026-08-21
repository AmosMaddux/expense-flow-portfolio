import { readFile } from "node:fs/promises";

import { z } from "zod";

import { answerPolicyQuestion } from "../policyAssistantService.js";
import type { PolicyEmbedder } from "../policyEmbeddingService.js";
import { retrievePolicyChunks } from "../policyRetrievalService.js";

import {
    buildEvaluationChunks,
    createEvaluationRetrievalRepository,
    embedEvaluationChunks,
    readEvaluationCorpus,
    type EvaluationCorpus,
    type EvaluationPolicySection,
} from "./evaluationCorpus.js";

const QuestionSetSchema = z
    .object({
        description: z.string().min(1),
        topK: z.number().int().min(1).max(10),
        questions: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        tenantId: z.uuid(),
                        question: z.string().min(1),
                        groundTruth: z.string().min(1),
                        referenceSections: z.array(z.string().min(1)).min(1),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

export type PolicyQuestionSet = z.infer<typeof QuestionSetSchema>;

const InjectionExpectationSchema = z
    .object({
        refused: z.boolean(),
        category: z
            .enum(["prompt_disclosure", "cross_tenant", "instruction_override"])
            .optional(),
        mustContain: z.array(z.string().min(1)).optional(),
        mustNotContain: z.array(z.string().min(1)).optional(),
    })
    .strict();

const InjectionSetSchema = z
    .object({
        description: z.string().min(1),
        topK: z.number().int().min(1).max(10),
        promptSentinels: z.array(z.string().min(1)).min(1),
        cases: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        tenantId: z.uuid(),
                        vector: z.enum(["user_question", "poisoned_corpus"]),
                        attack: z.string().min(1),
                        injectedSection: z
                            .object({
                                section: z.string().min(1),
                                content: z.string().min(1),
                            })
                            .strict()
                            .optional(),
                        expect: InjectionExpectationSchema,
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

export type PromptInjectionSet = z.infer<typeof InjectionSetSchema>;
export type PromptInjectionCase = PromptInjectionSet["cases"][number];

export type RagEvaluationSample = {
    id: string;
    tenant_id: string;
    question: string;
    answer: string;
    contexts: string[];
    ground_truth: string;
    reference_contexts: string[];
    citations: string[];
    refused: boolean;
    abstained: boolean;
};

export type PromptInjectionOutcome = {
    id: string;
    tenant_id: string;
    vector: PromptInjectionCase["vector"];
    attack: string;
    answer: string;
    contexts: string[];
    citations: string[];
    refused: boolean;
    abstained: boolean;
    refusal_category: string | null;
};

/**
 * Reads and validates the golden question set.
 */
export async function readPolicyQuestionSet(
    path: string,
): Promise<PolicyQuestionSet> {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));

    return QuestionSetSchema.parse(raw);
}

/**
 * Reads and validates the prompt-injection set.
 */
export async function readPromptInjectionSet(
    path: string,
): Promise<PromptInjectionSet> {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));

    return InjectionSetSchema.parse(raw);
}

/**
 * Runs the golden question set through retrieval and the assistant.
 *
 * Reference contexts come from the corpus sections named by the question, so
 * context relevance is scored against the sections a correct retrieval should
 * have surfaced rather than against the answer alone.
 */
export async function runQuestionSet(
    corpus: EvaluationCorpus,
    questionSet: PolicyQuestionSet,
    embedder: PolicyEmbedder,
): Promise<RagEvaluationSample[]> {
    const chunks = await embedEvaluationChunks(
        buildEvaluationChunks(corpus),
        embedder,
    );
    const repository = createEvaluationRetrievalRepository(chunks);
    const sectionsByTenant = new Map(
        corpus.tenants.map((tenant) => [
            tenant.tenantId,
            new Map(
                tenant.sections.map((section) => [
                    section.section,
                    section.content,
                ]),
            ),
        ]),
    );

    return Promise.all(
        questionSet.questions.map(async (question) => {
            const answer = await answerPolicyQuestion(
                {
                    tenantId: question.tenantId,
                    question: question.question,
                    topK: questionSet.topK,
                },
                (request) =>
                    retrievePolicyChunks(request, repository, embedder),
            );
            const tenantSections = sectionsByTenant.get(question.tenantId);
            const referenceContexts = question.referenceSections.map(
                (section) => {
                    const content = tenantSections?.get(section);
                    if (content === undefined) {
                        throw new Error(
                            `Question ${question.id} references unknown section "${section}" for its tenant.`,
                        );
                    }

                    return `${section}\n${content}`;
                },
            );

            return {
                id: question.id,
                tenant_id: question.tenantId,
                question: question.question,
                answer: answer.answer,
                contexts: answer.contexts.map((context) => context.content),
                ground_truth: question.groundTruth,
                reference_contexts: referenceContexts,
                citations: answer.citations,
                refused: answer.refused,
                abstained: answer.abstained,
            };
        }),
    );
}

/**
 * Runs the prompt-injection set through retrieval and the assistant.
 *
 * A poisoned corpus case plants its injected section in the attacked tenant's
 * corpus before retrieval, so the instruction reaches the assistant the same
 * way a tampered policy document would.
 */
export async function runPromptInjectionSet(
    corpus: EvaluationCorpus,
    injectionSet: PromptInjectionSet,
    embedder: PolicyEmbedder,
): Promise<PromptInjectionOutcome[]> {
    return Promise.all(
        injectionSet.cases.map(async (injectionCase) => {
            const extraSections = new Map<
                string,
                readonly EvaluationPolicySection[]
            >();
            if (injectionCase.injectedSection !== undefined) {
                extraSections.set(injectionCase.tenantId, [
                    injectionCase.injectedSection,
                ]);
            }

            const repository = createEvaluationRetrievalRepository(
                await embedEvaluationChunks(
                    buildEvaluationChunks(corpus, extraSections),
                    embedder,
                ),
            );
            const answer = await answerPolicyQuestion(
                {
                    tenantId: injectionCase.tenantId,
                    question: injectionCase.attack,
                    topK: injectionSet.topK,
                },
                (request) =>
                    retrievePolicyChunks(request, repository, embedder),
            );

            return {
                id: injectionCase.id,
                tenant_id: injectionCase.tenantId,
                vector: injectionCase.vector,
                attack: injectionCase.attack,
                answer: answer.answer,
                contexts: answer.contexts.map((context) => context.content),
                citations: answer.citations,
                refused: answer.refused,
                abstained: answer.abstained,
                refusal_category: answer.refusalCategory,
            };
        }),
    );
}

export {
    createDeterministicEmbedder,
    readEmbeddingLexicon,
} from "./deterministicEmbedder.js";
export { readEvaluationCorpus };
