import { afterEach, describe, expect, test, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { RedisClientType } from "redis";

import {
    createIdempotencyStore,
    IdempotencyRequestMismatchError,
    toDynamoPartitionKey,
    toRedisLockKey,
    toRedisResultKey,
} from "./idempotencyStore.js";

afterEach(() => {
    vi.useRealTimers();
});

void describe("idempotency key builders", () => {
    void test("scopes Redis and DynamoDB keys by tenant", () => {
        const tenantId = "40000000-0000-4000-8000-000000000201";
        const idempotencyKey = "expense-submit-1";

        expect(toRedisResultKey(tenantId, idempotencyKey)).toBe(
            "idem:40000000-0000-4000-8000-000000000201:expense-submit-1",
        );
        expect(toRedisLockKey(tenantId, idempotencyKey)).toBe(
            "lock:40000000-0000-4000-8000-000000000201:expense-submit-1",
        );
        expect(toDynamoPartitionKey(tenantId, idempotencyKey)).toBe(
            "idem:40000000-0000-4000-8000-000000000201:expense-submit-1",
        );
    });
});

void describe("idempotency store", () => {
    void test("persists create recovery metadata in DynamoDB reservations", async () => {
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const dynamoDb = createDynamoMock();
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as unknown as DynamoDBDocumentClient,
            redis as unknown as RedisClientType,
            "idempotency-table",
        );

        const reserved = await store.reserveSubmission(
            "tenant",
            "key",
            "lock-token",
            "request-hash-one",
            {
                operation: "create_expense_report",
                resourceId: "10000000-0000-4000-8000-000000000201",
                tenantId: "tenant",
            },
        );

        expect(reserved).toBe(true);
        expect(dynamoDb.send).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({
                    Item: expect.objectContaining({
                        operation: "create_expense_report",
                        pk: "idem:tenant:key",
                        requestHash: "request-hash-one",
                        resourceId: "10000000-0000-4000-8000-000000000201",
                        status: "in_progress",
                        submissionToken: "lock-token",
                        tenantId: "tenant",
                    }),
                }),
            }),
        );
    });

    void test("hydrates Redis only for the remaining DynamoDB TTL", async () => {
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const dynamoDb = createDynamoMock({
            Item: {
                pk: "idem:tenant:key",
                requestHash: "request-hash-one",
                result: { body: { id: "report-1" }, statusCode: 201 },
                status: "completed",
                ttl: 1_785_542_460,
            },
        });
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as unknown as DynamoDBDocumentClient,
            redis as unknown as RedisClientType,
            "idempotency-table",
        );

        const result = await store.getResult(
            "tenant",
            "key",
            "request-hash-one",
        );

        expect(result).toEqual({ body: { id: "report-1" }, statusCode: 201 });
        expect(redis.set).toHaveBeenCalledWith(
            "idem:tenant:key",
            JSON.stringify({
                requestHash: "request-hash-one",
                result: { body: { id: "report-1" }, statusCode: 201 },
            }),
            { EX: 60 },
        );
    });

    void test("rejects cached results for a different request hash", async () => {
        const dynamoDb = createDynamoMock();
        const redis = createRedisMock({
            get: vi.fn().mockResolvedValue(
                JSON.stringify({
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                }),
            ),
        });
        const store = createIdempotencyStore(
            dynamoDb as unknown as DynamoDBDocumentClient,
            redis as unknown as RedisClientType,
            "idempotency-table",
        );

        await expect(
            store.getResult("tenant", "key", "request-hash-two"),
        ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);
        expect(dynamoDb.send).not.toHaveBeenCalled();
    });
});

function createDynamoMock(result: unknown = {}) {
    return {
        send: vi.fn().mockResolvedValue(result),
    };
}

function createRedisMock(overrides = {}) {
    return {
        connect: vi.fn().mockResolvedValue(undefined),
        eval: vi.fn().mockResolvedValue(1),
        get: vi.fn().mockResolvedValue(null),
        isOpen: true,
        set: vi.fn().mockResolvedValue("OK"),
        ...overrides,
    };
}
