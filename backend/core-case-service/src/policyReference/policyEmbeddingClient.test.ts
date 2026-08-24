import { describe, expect, test, vi } from "vitest";

import { createPolicyEmbeddings } from "./policyEmbeddingClient.js";
import { PolicyEmbeddingServiceError } from "./policyEmbeddingErrors.js";

const clientOptions = {
    apiKey: "synthetic-policy-embedding-key",
    baseUrl: "https://embeddings.example.test/v1",
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function embeddingVector(seed: number, dimensions = 3): number[] {
    return Array.from({ length: dimensions }, (_value, index) => seed + index);
}

void describe("createPolicyEmbeddings", () => {
    void test("posts the model request and returns vectors in input order", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(
            jsonResponse({
                model: "text-embedding-3-small",
                data: [
                    { index: 1, embedding: embeddingVector(10) },
                    { index: 0, embedding: embeddingVector(0) },
                ],
            }),
        );

        const result = await createPolicyEmbeddings(
            {
                input: ["Meals require a receipt.", "Mileage is reimbursable."],
                model: "text-embedding-3-small",
                dimensions: 3,
            },
            { ...clientOptions, fetchImplementation },
        );

        expect(result.model).toBe("text-embedding-3-small");
        expect(result.embeddings).toEqual([
            embeddingVector(0),
            embeddingVector(10),
        ]);

        const [endpoint, init] = fetchImplementation.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(endpoint).toBe("https://embeddings.example.test/v1/embeddings");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>).Authorization).toBe(
            "Bearer synthetic-policy-embedding-key",
        );
    });

    void test("retries a rate-limited response", async () => {
        const fetchImplementation = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
            .mockResolvedValueOnce(
                jsonResponse({
                    model: "text-embedding-3-small",
                    data: [{ index: 0, embedding: embeddingVector(1) }],
                }),
            );

        const result = await createPolicyEmbeddings(
            {
                input: ["Meals require a receipt."],
                model: "text-embedding-3-small",
                dimensions: 3,
            },
            {
                ...clientOptions,
                fetchImplementation,
                maxRetries: 1,
                delayImplementation: () => Promise.resolve(),
                random: () => 0,
            },
        );

        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(result.embeddings).toEqual([embeddingVector(1)]);
    });

    void test("does not leak the response body when the provider rejects the request", async () => {
        const fetchImplementation = vi
            .fn()
            .mockResolvedValue(
                jsonResponse(
                    { error: "Meals require a receipt for tenant policy." },
                    400,
                ),
            );

        await expect(
            createPolicyEmbeddings(
                {
                    input: ["Meals require a receipt."],
                    model: "text-embedding-3-small",
                    dimensions: 3,
                },
                { ...clientOptions, fetchImplementation },
            ),
        ).rejects.toThrow(
            new PolicyEmbeddingServiceError(
                "The policy embedding provider rejected the request.",
                400,
            ),
        );
    });

    void test("rejects a vector with the wrong dimension count", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(
            jsonResponse({
                model: "text-embedding-3-small",
                data: [{ index: 0, embedding: embeddingVector(0, 2) }],
            }),
        );

        await expect(
            createPolicyEmbeddings(
                {
                    input: ["Meals require a receipt."],
                    model: "text-embedding-3-small",
                    dimensions: 3,
                },
                { ...clientOptions, fetchImplementation },
            ),
        ).rejects.toThrow(PolicyEmbeddingServiceError);
    });

    void test("rejects a response that omits a requested vector", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(
            jsonResponse({
                model: "text-embedding-3-small",
                data: [{ index: 0, embedding: embeddingVector(0) }],
            }),
        );

        await expect(
            createPolicyEmbeddings(
                {
                    input: ["Meals require a receipt.", "Mileage rules."],
                    model: "text-embedding-3-small",
                    dimensions: 3,
                },
                { ...clientOptions, fetchImplementation },
            ),
        ).rejects.toThrow(PolicyEmbeddingServiceError);
    });

    void test("rejects blank input before calling the provider", async () => {
        const fetchImplementation = vi.fn();

        await expect(
            createPolicyEmbeddings(
                {
                    input: ["   "],
                    model: "text-embedding-3-small",
                    dimensions: 3,
                },
                { ...clientOptions, fetchImplementation },
            ),
        ).rejects.toThrow();
        expect(fetchImplementation).not.toHaveBeenCalled();
    });
});
