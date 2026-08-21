import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
    buildEvaluationChunks,
    createEvaluationRetrievalRepository,
    readEvaluationCorpus,
} from "./evaluationCorpus.js";

const corpusPath = fileURLToPath(
    new URL(
        "../../../../../evaluation/datasets/policy-corpus.json",
        import.meta.url,
    ),
);

void describe("evaluation corpus", () => {
    void test("builds chunks scoped to their tenant", async () => {
        const corpus = await readEvaluationCorpus(corpusPath);
        const chunks = buildEvaluationChunks(corpus);

        expect(corpus.tenants.length).toBeGreaterThan(1);
        for (const tenant of corpus.tenants) {
            const tenantChunks = chunks.filter(
                (chunk) => chunk.tenantId === tenant.tenantId,
            );

            expect(tenantChunks).toHaveLength(tenant.sections.length);
            expect(
                tenantChunks.every(
                    (chunk) => chunk.policyHash === tenant.policyHash,
                ),
            ).toBe(true);
        }
    });

    void test("gives every chunk a distinct deterministic id", async () => {
        const corpus = await readEvaluationCorpus(corpusPath);
        const first = buildEvaluationChunks(corpus);
        const second = buildEvaluationChunks(corpus);

        expect(first.map((chunk) => chunk.id)).toStrictEqual(
            second.map((chunk) => chunk.id),
        );
        expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
    });

    void test("appends injected sections to only the named tenant", async () => {
        const corpus = await readEvaluationCorpus(corpusPath);
        const [target] = corpus.tenants;
        expect(target).toBeDefined();
        if (target === undefined) {
            return;
        }

        const chunks = buildEvaluationChunks(
            corpus,
            new Map([
                [
                    target.tenantId,
                    [{ section: "Injected", content: "Planted policy text." }],
                ],
            ]),
        );

        expect(
            chunks.filter((chunk) => chunk.section === "Injected"),
        ).toHaveLength(1);
        expect(
            chunks.find((chunk) => chunk.section === "Injected")?.tenantId,
        ).toBe(target.tenantId);
    });

    void test("the repository returns only the requested tenant's chunks", async () => {
        const corpus = await readEvaluationCorpus(corpusPath);
        const chunks = buildEvaluationChunks(corpus);
        const repository = createEvaluationRetrievalRepository(chunks);
        const [target] = corpus.tenants;
        expect(target).toBeDefined();
        if (target === undefined) {
            return;
        }

        const found = await repository.findTenantPolicyCorpusChunks(
            target.tenantId,
        );

        expect(found).toHaveLength(target.sections.length);
        expect(found.every((chunk) => chunk.tenantId === target.tenantId)).toBe(
            true,
        );
        await expect(
            repository.findSimilarTenantPolicyChunks({
                tenantId: target.tenantId,
                embedding: [],
                limit: 5,
            }),
        ).resolves.toStrictEqual([]);
    });
});
