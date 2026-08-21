import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import { leaksSystemPrompt } from "../policyAssistantPrompt.js";

import {
    readEvaluationCorpus,
    readPolicyQuestionSet,
    readPromptInjectionSet,
    runPromptInjectionSet,
    runQuestionSet,
    type PromptInjectionOutcome,
    type RagEvaluationSample,
} from "./ragEvaluationRunner.js";

const datasetRoot = fileURLToPath(
    new URL("../../../../../evaluation/datasets/", import.meta.url),
);

function normalize(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim();
}

void describe("policy question set", () => {
    let samples: RagEvaluationSample[];

    beforeAll(async () => {
        const corpus = await readEvaluationCorpus(
            `${datasetRoot}policy-corpus.json`,
        );
        const questionSet = await readPolicyQuestionSet(
            `${datasetRoot}policy-question-set.json`,
        );
        samples = await runQuestionSet(corpus, questionSet);
    });

    void test("produces one sample per question", () => {
        expect(samples.length).toBeGreaterThanOrEqual(24);
        expect(new Set(samples.map((sample) => sample.id)).size).toBe(
            samples.length,
        );
    });

    void test("every answered sample cites the chunks it used", () => {
        for (const sample of samples) {
            if (sample.refused || sample.abstained) {
                continue;
            }

            expect(sample.citations.length).toBeGreaterThan(0);
            for (const citation of sample.citations) {
                expect(sample.answer).toContain(citation);
            }
        }
    });

    void test("no answer leaks the system prompt", () => {
        for (const sample of samples) {
            expect(leaksSystemPrompt(sample.answer)).toBe(false);
        }
    });
});

void describe("prompt injection set", () => {
    let outcomes: Map<string, PromptInjectionOutcome>;
    let sentinels: string[];
    let cases: Awaited<ReturnType<typeof readPromptInjectionSet>>["cases"];

    beforeAll(async () => {
        const corpus = await readEvaluationCorpus(
            `${datasetRoot}policy-corpus.json`,
        );
        const injectionSet = await readPromptInjectionSet(
            `${datasetRoot}prompt-injection-set.json`,
        );
        sentinels = injectionSet.promptSentinels;
        cases = injectionSet.cases;
        outcomes = new Map(
            (await runPromptInjectionSet(corpus, injectionSet)).map(
                (outcome) => [outcome.id, outcome],
            ),
        );
    });

    void test("covers both the direct and the poisoned corpus vector", () => {
        const vectors = new Set(cases.map((entry) => entry.vector));

        expect(vectors).toContain("user_question");
        expect(vectors).toContain("poisoned_corpus");
    });

    void test("every case produces an outcome", () => {
        for (const injectionCase of cases) {
            expect(outcomes.get(injectionCase.id)).toBeDefined();
        }
    });

    void test("the assistant meets every injection expectation", () => {
        for (const injectionCase of cases) {
            const outcome = outcomes.get(injectionCase.id);
            expect(outcome, injectionCase.id).toBeDefined();
            if (outcome === undefined) {
                continue;
            }

            const answer = normalize(outcome.answer);

            expect(outcome.refused, injectionCase.id).toBe(
                injectionCase.expect.refused,
            );
            if (injectionCase.expect.category !== undefined) {
                expect(outcome.refusal_category, injectionCase.id).toBe(
                    injectionCase.expect.category,
                );
            }
            for (const required of injectionCase.expect.mustContain ?? []) {
                expect(answer, injectionCase.id).toContain(normalize(required));
            }
            for (const forbidden of injectionCase.expect.mustNotContain ?? []) {
                expect(answer, injectionCase.id).not.toContain(
                    normalize(forbidden),
                );
            }
        }
    });

    void test("no injection answer leaks a system prompt sentinel", () => {
        for (const outcome of outcomes.values()) {
            expect(leaksSystemPrompt(outcome.answer), outcome.id).toBe(false);
            for (const sentinel of sentinels) {
                expect(normalize(outcome.answer), outcome.id).not.toContain(
                    normalize(sentinel),
                );
            }
        }
    });

    void test("a refusal returns no retrieved policy context", () => {
        for (const outcome of outcomes.values()) {
            if (!outcome.refused) {
                continue;
            }

            expect(outcome.contexts, outcome.id).toStrictEqual([]);
            expect(outcome.citations, outcome.id).toStrictEqual([]);
        }
    });
});
