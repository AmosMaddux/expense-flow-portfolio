import { describe, expect, test } from "vitest";

import { loadIdempotencyConfig } from "./idempotencyConfig.js";

void describe("idempotency configuration", () => {
    void test("uses local defaults when infrastructure settings are absent", () => {
        expect(loadIdempotencyConfig({})).toEqual({
            dynamoDbRegion: "us-east-1",
            dynamoDbTableName: "expenseflow-idempotency-local",
            redisUrl: "redis://127.0.0.1:6379",
        });
    });

    void test("loads explicit infrastructure settings", () => {
        expect(
            loadIdempotencyConfig({
                AWS_REGION: "us-west-2",
                DYNAMODB_ENDPOINT: "http://dynamodb.example.test",
                DYNAMODB_IDEMPOTENCY_TABLE_NAME: "synthetic-idempotency",
                REDIS_URL: "redis://redis.example.test:6379",
            }),
        ).toEqual({
            dynamoDbEndpoint: "http://dynamodb.example.test",
            dynamoDbRegion: "us-west-2",
            dynamoDbTableName: "synthetic-idempotency",
            redisUrl: "redis://redis.example.test:6379",
        });
    });
});
