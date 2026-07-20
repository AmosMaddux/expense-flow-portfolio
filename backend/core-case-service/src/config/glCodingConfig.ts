import { z } from "zod";

const glCodingEnvironmentSchema = z.object({
    GL_CODING_SERVICE_BASE_URL: z
        .string()
        .url()
        .default("http://127.0.0.1:8000"),
    GL_CODING_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    GL_CODING_MAX_RETRIES: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(2),
    GL_CODING_BASE_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(100),
    GL_CODING_MAX_BACKOFF_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(1_000),
});

export type GlCodingConfig = z.infer<typeof glCodingEnvironmentSchema>;

/**
 * Reads GL-coding service client settings from the environment.
 */
export function loadGlCodingConfig(
    environment: NodeJS.ProcessEnv = process.env,
): GlCodingConfig {
    return glCodingEnvironmentSchema.parse(environment);
}
