export type IdempotencyConfig = {
    redisUrl: string;
    storeBackend: "memory" | "redis";
};

/**
 * Loads infrastructure settings for tenant-scoped Redis idempotency storage.
 */
export function loadIdempotencyConfig(
    env: NodeJS.ProcessEnv = process.env,
): IdempotencyConfig {
    return {
        redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
        storeBackend:
            env.IDEMPOTENCY_STORE_BACKEND === "memory" ? "memory" : "redis",
    };
}
