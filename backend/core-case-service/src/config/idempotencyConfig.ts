export type IdempotencyConfig = {
    dynamoDbEndpoint?: string;
    dynamoDbRegion: string;
    dynamoDbTableName: string;
    redisUrl: string;
    storeBackend: "memory" | "dynamodb";
};

/**
 * Loads infrastructure settings for tenant-scoped idempotency storage.
 */
export function loadIdempotencyConfig(
    env: NodeJS.ProcessEnv = process.env,
): IdempotencyConfig {
    return {
        ...(env.DYNAMODB_ENDPOINT === undefined
            ? {}
            : { dynamoDbEndpoint: env.DYNAMODB_ENDPOINT }),
        dynamoDbRegion: env.AWS_REGION ?? "us-east-1",
        dynamoDbTableName:
            env.DYNAMODB_IDEMPOTENCY_TABLE_NAME ??
            "expenseflow-idempotency-local",
        redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
        storeBackend:
            env.IDEMPOTENCY_STORE_BACKEND === "dynamodb"
                ? "dynamodb"
                : "memory",
    };
}
