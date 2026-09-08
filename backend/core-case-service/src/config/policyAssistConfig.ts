import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const policyAssistEnvironmentSchema = z.object({
    POLICY_ASSIST_API_KEY: z.string().min(1),
    POLICY_ASSIST_BASE_URL: z
        .string()
        .url()
        .default("https://api.openai.com/v1"),
    POLICY_ASSIST_MODEL: z.string().min(1).default("gpt-4o-mini"),
    POLICY_ASSIST_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(120_000)
        .default(30_000),
    POLICY_ASSIST_MAX_RETRIES: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5)
        .default(1),
    POLICY_ASSIST_BASE_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5_000)
        .default(250),
    POLICY_ASSIST_MAX_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(30_000)
        .default(2_000),
});

export type PolicyAssistConfig = z.infer<typeof policyAssistEnvironmentSchema>;

let defaultPolicyAssistConfig: PolicyAssistConfig | undefined;

/**
 * Reads policy assist model provider settings from the environment.
 */
export function loadPolicyAssistConfig(
    environment: NodeJS.ProcessEnv = process.env,
): PolicyAssistConfig {
    const parsed = policyAssistEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map((issue) => issue.path.join("."))
            .filter((field) => field.length > 0)
            .join(", ");
        throw new ConfigurationError(
            `Policy assist configuration is invalid: ${fields}.`,
            {
                cause: parsed.error,
            },
        );
    }

    return parsed.data;
}

/**
 * Returns the process-wide policy assist provider settings.
 */
export function loadDefaultPolicyAssistConfig(): PolicyAssistConfig {
    defaultPolicyAssistConfig ??= loadPolicyAssistConfig();

    return defaultPolicyAssistConfig;
}

/**
 * Reports whether policy assist model calls are configured for this process.
 */
export function isPolicyAssistConfigured(
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return policyAssistEnvironmentSchema.safeParse(environment).success;
}
