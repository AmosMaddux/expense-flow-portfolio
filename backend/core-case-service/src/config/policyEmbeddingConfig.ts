import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";
import { policyChunkEmbeddingDimensions } from "../db/schema/index.js";

const policyEmbeddingEnvironmentSchema = z.object({
    POLICY_EMBEDDING_API_KEY: z.string().min(1),
    POLICY_EMBEDDING_BASE_URL: z
        .string()
        .url()
        .default("https://api.openai.com/v1"),
    POLICY_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
    POLICY_EMBEDDING_DIMENSIONS: z.coerce
        .number()
        .int()
        .positive()
        .max(4_096)
        .default(policyChunkEmbeddingDimensions),
    POLICY_EMBEDDING_BATCH_SIZE: z.coerce
        .number()
        .int()
        .positive()
        .max(256)
        .default(64),
    POLICY_EMBEDDING_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(120_000)
        .default(30_000),
    POLICY_EMBEDDING_MAX_RETRIES: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5)
        .default(2),
    POLICY_EMBEDDING_BASE_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5_000)
        .default(200),
    POLICY_EMBEDDING_MAX_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(30_000)
        .default(2_000),
});

export type PolicyEmbeddingConfig = z.infer<
    typeof policyEmbeddingEnvironmentSchema
>;

let defaultPolicyEmbeddingConfig: PolicyEmbeddingConfig | undefined;

/**
 * Reads policy embedding provider settings from the environment.
 */
export function loadPolicyEmbeddingConfig(
    environment: NodeJS.ProcessEnv = process.env,
): PolicyEmbeddingConfig {
    const parsed = policyEmbeddingEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map((issue) => issue.path.join("."))
            .filter((field) => field.length > 0)
            .join(", ");
        throw new ConfigurationError(
            `Policy embedding configuration is invalid: ${fields}.`,
            {
                cause: parsed.error,
            },
        );
    }

    if (
        parsed.data.POLICY_EMBEDDING_DIMENSIONS !==
        policyChunkEmbeddingDimensions
    ) {
        throw new ConfigurationError(
            `Policy embedding dimensions must be ${String(policyChunkEmbeddingDimensions)} to match the pgvector column.`,
        );
    }

    return parsed.data;
}

/**
 * Returns the process-wide policy embedding provider settings.
 */
export function loadDefaultPolicyEmbeddingConfig(): PolicyEmbeddingConfig {
    defaultPolicyEmbeddingConfig ??= loadPolicyEmbeddingConfig();

    return defaultPolicyEmbeddingConfig;
}

/**
 * Reports whether policy embeddings are configured for this process.
 *
 * Retrieval must keep working without an embedding provider, so callers use
 * this to fall back to lexical-only ranking instead of failing the request.
 */
export function isPolicyEmbeddingConfigured(
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return policyEmbeddingEnvironmentSchema.safeParse(environment).success;
}
