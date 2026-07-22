import { z } from "zod";

const rateLimitEnvironmentSchema = z.object({
    CORE_CASE_RATE_LIMIT_REQUESTS: z.coerce
        .number()
        .int()
        .positive()
        .default(100),
    CORE_CASE_RATE_LIMIT_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(60),
});

export type RateLimitConfig = {
    requests: number;
    windowSeconds: number;
};

/**
 * Reads and validates per-tenant rate-limit settings from the environment.
 */
export function loadRateLimitConfig(
    environment: NodeJS.ProcessEnv = process.env,
): RateLimitConfig {
    const parsedEnvironment = rateLimitEnvironmentSchema.parse(environment);

    return {
        requests: parsedEnvironment.CORE_CASE_RATE_LIMIT_REQUESTS,
        windowSeconds: parsedEnvironment.CORE_CASE_RATE_LIMIT_WINDOW_SECONDS,
    };
}
