import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const glCodingEnvironmentSchema = z.object({
    GL_CODING_SERVICE_BASE_URL: z.string().url(),
    GL_CODING_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(30_000)
        .default(5_000),
    GL_CODING_MAX_RETRIES: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5)
        .default(2),
    GL_CODING_BASE_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(5_000)
        .default(100),
    GL_CODING_MAX_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(30_000)
        .default(1_000),
});

export type GlCodingConfig = z.infer<typeof glCodingEnvironmentSchema>;

let defaultGlCodingConfig: GlCodingConfig | undefined;

/**
 * Reads GL-coding service client settings from the environment.
 */
export function loadGlCodingConfig(
    environment: NodeJS.ProcessEnv = process.env,
): GlCodingConfig {
    const parsed = glCodingEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map((issue) => issue.path.join("."))
            .filter((field) => field.length > 0)
            .join(", ");
        throw new ConfigurationError(
            `GL-coding configuration is invalid: ${fields}.`,
            {
                cause: parsed.error,
            },
        );
    }

    return parsed.data;
}

/**
 * Returns the process-wide GL-coding service client settings.
 */
export function loadDefaultGlCodingConfig(): GlCodingConfig {
    defaultGlCodingConfig ??= loadGlCodingConfig();

    return defaultGlCodingConfig;
}
