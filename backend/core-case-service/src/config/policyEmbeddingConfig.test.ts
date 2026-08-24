import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";

import {
    isPolicyEmbeddingConfigured,
    loadPolicyEmbeddingConfig,
} from "./policyEmbeddingConfig.js";

const syntheticEnvironment = {
    POLICY_EMBEDDING_API_KEY: "synthetic-policy-embedding-key",
};

void describe("loadPolicyEmbeddingConfig", () => {
    void test("applies OpenAI embedding defaults", () => {
        const config = loadPolicyEmbeddingConfig(syntheticEnvironment);

        expect(config.POLICY_EMBEDDING_BASE_URL).toBe(
            "https://api.openai.com/v1",
        );
        expect(config.POLICY_EMBEDDING_MODEL).toBe("text-embedding-3-small");
        expect(config.POLICY_EMBEDDING_DIMENSIONS).toBe(1536);
        expect(config.POLICY_EMBEDDING_BATCH_SIZE).toBe(64);
    });

    void test("reads overrides from the environment", () => {
        const config = loadPolicyEmbeddingConfig({
            ...syntheticEnvironment,
            POLICY_EMBEDDING_BASE_URL: "https://embeddings.example.test/v1",
            POLICY_EMBEDDING_MODEL: "text-embedding-3-large",
            POLICY_EMBEDDING_BATCH_SIZE: "16",
            POLICY_EMBEDDING_MAX_RETRIES: "3",
        });

        expect(config.POLICY_EMBEDDING_BASE_URL).toBe(
            "https://embeddings.example.test/v1",
        );
        expect(config.POLICY_EMBEDDING_MODEL).toBe("text-embedding-3-large");
        expect(config.POLICY_EMBEDDING_BATCH_SIZE).toBe(16);
        expect(config.POLICY_EMBEDDING_MAX_RETRIES).toBe(3);
    });

    void test("rejects a missing API key", () => {
        expect(() => loadPolicyEmbeddingConfig({})).toThrow(ConfigurationError);
    });

    void test("rejects dimensions that do not match the pgvector column", () => {
        expect(() =>
            loadPolicyEmbeddingConfig({
                ...syntheticEnvironment,
                POLICY_EMBEDDING_DIMENSIONS: "3072",
            }),
        ).toThrow(ConfigurationError);
    });
});

void describe("isPolicyEmbeddingConfigured", () => {
    void test("is false without an API key", () => {
        expect(isPolicyEmbeddingConfigured({})).toBe(false);
    });

    void test("is true with an API key", () => {
        expect(isPolicyEmbeddingConfigured(syntheticEnvironment)).toBe(true);
    });
});
