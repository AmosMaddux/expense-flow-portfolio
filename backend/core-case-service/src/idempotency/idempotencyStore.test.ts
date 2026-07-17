import { afterEach, describe, expect, test, vi } from "vitest";

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

void describe("idempotency store TTL handling", () => {
    void test("hydrates Redis only for the remaining DynamoDB TTL", async () => {
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    pk: "idem:tenant:key",
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                    status: "completed",
                    ttl: 1_785_542_460,
                },
            }),
        };
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
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

    void test("treats expired DynamoDB records as missing", async () => {
        vi.setSystemTime(new Date("2026-08-01T00:01:00.000Z"));
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    pk: "idem:tenant:key",
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                    status: "completed",
                    ttl: 1_785_542_400,
                },
            }),
        };
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
            "idempotency-table",
        );

        const result = await store.getResult(
            "tenant",
            "key",
            "request-hash-one",
        );

        expect(result).toBeUndefined();
        expect(redis.set).not.toHaveBeenCalled();
    });

    void test("rejects cached results for a different request hash", async () => {
        const dynamoDb = {
            send: vi.fn(),
        };
        const redis = createRedisMock({
            get: vi.fn().mockResolvedValue(
                JSON.stringify({
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                }),
            ),
        });
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
            "idempotency-table",
        );

        await expect(
            store.getResult("tenant", "key", "request-hash-two"),
        ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);

        expect(dynamoDb.send).not.toHaveBeenCalled();
    });

    void test("rejects DynamoDB records for a different request hash", async () => {
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    pk: "idem:tenant:key",
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                    status: "completed",
                    ttl: 1_785_542_460,
                },
            }),
        };
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
            "idempotency-table",
        );

        await expect(
            store.getResult("tenant", "key", "request-hash-two"),
        ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);

        expect(redis.set).not.toHaveBeenCalled();
    });
});

type RedisMock = {
    connect: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    isOpen: boolean;
    set: ReturnType<typeof vi.fn>;
};

function createRedisMock(overrides: Partial<RedisMock> = {}): RedisMock {
    return {
        connect: vi.fn().mockResolvedValue(undefined),
        eval: vi.fn().mockResolvedValue(1),
        get: vi.fn().mockResolvedValue(null),
        isOpen: true,
        set: vi.fn().mockResolvedValue("OK"),
        ...overrides,
    };
}
