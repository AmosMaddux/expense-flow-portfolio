import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import { retrievePolicyChunks } from "../policyRetrievalService.js";

import {
    buildEvaluationChunks,
    createEvaluationRetrievalRepository,
    embedEvaluationChunks,
    readEvaluationCorpus,
    type EvaluationCorpus,
} from "./evaluationCorpus.js";
import {
    cosineSimilarity,
    createDeterministicEmbedder,
    readEmbeddingLexicon,
} from "./deterministicEmbedder.js";
import type { PolicyEmbedder } from "../policyEmbeddingService.js";

const datasetRoot = fileURLToPath(
    new URL("../../../../../evaluation/datasets/", import.meta.url),
);
const northwind = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";

// Models "the embedding provider is gone", which is also what removing vector
// ranking from retrieval would look like to this harness.
const nullEmbedder: PolicyEmbedder = {
    model: "none",
    embedTexts: (texts) => Promise.resolve(texts.map(() => [])),
};

let corpus: EvaluationCorpus;
let embedder: PolicyEmbedder;

async function topSection(
    question: string,
    activeEmbedder: PolicyEmbedder,
): Promise<string | undefined> {
    const chunks = await embedEvaluationChunks(
        buildEvaluationChunks(corpus),
        activeEmbedder,
    );
    const { chunks: retrieved } = await retrievePolicyChunks(
        { tenantId: northwind, query: question, topK: 4 },
        createEvaluationRetrievalRepository(chunks),
        activeEmbedder,
    );

    return retrieved[0]?.section;
}

void describe("deterministic embedder", () => {
    beforeAll(async () => {
        corpus = await readEvaluationCorpus(`${datasetRoot}policy-corpus.json`);
        embedder = createDeterministicEmbedder(
            await readEmbeddingLexicon(`${datasetRoot}embedding-lexicon.json`),
        );
    });

    void test("produces a stable vector for the same text", async () => {
        const [first] = await embedder.embedTexts(["Meals are capped daily."]);
        const [second] = await embedder.embedTexts(["Meals are capped daily."]);

        expect(first).toStrictEqual(second);
        expect(first?.length).toBeGreaterThan(0);
    });

    void test("normalises vectors to unit length", async () => {
        const [vector] = await embedder.embedTexts([
            "Hotel minibar and room upgrade charges are not reimbursable.",
        ]);
        const magnitude = Math.sqrt(
            (vector ?? []).reduce((total, value) => total + value * value, 0),
        );

        expect(magnitude).toBeCloseTo(1, 6);
    });

    void test("scores a paraphrase closer to its section than to an unrelated one", async () => {
        const [question, lodging, airTravel] = await embedder.embedTexts([
            "Can I claim the snacks from the fridge in my hotel room?",
            "Lodging\nRoom upgrades, minibar charges, and in-room entertainment are not reimbursable.",
            "Air Travel\nEconomy class is the reimbursable fare class for all flights.",
        ]);

        expect(cosineSimilarity(question ?? [], lodging ?? [])).toBeGreaterThan(
            cosineSimilarity(question ?? [], airTravel ?? []),
        );
    });

    void test("gives text matching no concept axis a zero vector", async () => {
        const [vector] = await embedder.embedTexts(["zzzz qqqq wwww"]);

        expect(vector?.every((value) => value === 0)).toBe(true);
        expect(cosineSimilarity(vector ?? [], vector ?? [])).toBe(0);
    });

    void test("rejects a mismatched or empty vector pair", () => {
        expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
        expect(cosineSimilarity([], [])).toBe(0);
    });
});

void describe("vector ranking materially changes retrieval", () => {
    beforeAll(async () => {
        corpus = await readEvaluationCorpus(`${datasetRoot}policy-corpus.json`);
        embedder = createDeterministicEmbedder(
            await readEmbeddingLexicon(`${datasetRoot}embedding-lexicon.json`),
        );
    });

    // These paraphrases share almost no vocabulary with the section that
    // answers them, so lexical ranking alone cannot surface it. If vector
    // ranking is removed or broken, these assertions fail and so does the gate.
    void test.each([
        [
            "What do I get back for driving my own car to a client site?",
            "Mileage",
        ],
        [
            "Is a speeding fine something I can claim back?",
            "Non-Reimbursable Expenses",
        ],
        ["Can I claim the snacks from the fridge in my hotel room?", "Lodging"],
    ])("retrieves %j into the %s section", async (question, section) => {
        expect(await topSection(question, embedder)).toBe(section);
    });

    void test("loses the paraphrase sections without an embedder", async () => {
        const withVectors = await Promise.all(
            [
                "What do I get back for driving my own car to a client site?",
                "Is a speeding fine something I can claim back?",
            ].map((question) => topSection(question, embedder)),
        );
        const withoutVectors = await Promise.all(
            [
                "What do I get back for driving my own car to a client site?",
                "Is a speeding fine something I can claim back?",
            ].map((question) => topSection(question, nullEmbedder)),
        );

        expect(withVectors).toStrictEqual([
            "Mileage",
            "Non-Reimbursable Expenses",
        ]);
        expect(withoutVectors).not.toStrictEqual(withVectors);
    });

    void test("never lets a vector match cross the tenant boundary", async () => {
        const chunks = await embedEvaluationChunks(
            buildEvaluationChunks(corpus),
            embedder,
        );
        const { chunks: retrieved } = await retrievePolicyChunks(
            {
                tenantId: northwind,
                query: "confidential negotiated carrier rate card",
                topK: 10,
            },
            createEvaluationRetrievalRepository(chunks),
            embedder,
        );

        expect(retrieved.every((chunk) => chunk.tenantId === northwind)).toBe(
            true,
        );
        expect(
            retrieved.some((chunk) => chunk.content.includes("rate card")),
        ).toBe(false);
    });

    void test("ignores vectors embedded by a different model", async () => {
        const chunks = await embedEvaluationChunks(
            buildEvaluationChunks(corpus),
            embedder,
        );
        const repository = createEvaluationRetrievalRepository(chunks);
        const [queryVector] = await embedder.embedTexts(["mileage per mile"]);

        const sameModel = await repository.findSimilarTenantPolicyChunks({
            tenantId: northwind,
            embedding: queryVector ?? [],
            embeddingModel: embedder.model,
            limit: 10,
        });
        const otherModel = await repository.findSimilarTenantPolicyChunks({
            tenantId: northwind,
            embedding: queryVector ?? [],
            embeddingModel: "some-other-model",
            limit: 10,
        });

        expect(sameModel.length).toBeGreaterThan(0);
        expect(otherModel).toStrictEqual([]);
    });
});
