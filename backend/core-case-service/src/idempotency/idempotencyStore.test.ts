import { describe, expect, test, vi } from "vitest";

import {
    createIdempotencyStore,
    IdempotencyRequestMismatchError,
    toDynamoPartitionKey,
    toRedisLockKey,
    toRedisResultKey,
} from "./idempotencyStore.js";

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
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({}),
        };
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
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
                    ConditionExpression: "attribute_not_exists(pk)",
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

    void test("hydrates Redis for 24 hours from a durable DynamoDB result", async () => {
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    pk: "idem:tenant:key",
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                    status: "completed",
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
            { EX: 86_400 },
        );
    });

    void test("mirrors saved DynamoDB results into Redis for 24 hours", async () => {
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({}),
        };
        const redis = createRedisMock();
        const store = createIdempotencyStore(
            dynamoDb as never,
            redis as never,
            "idempotency-table",
        );
        const result = { body: { id: "report-1" }, statusCode: 201 };

        await store.saveResult(
            "tenant",
            "key",
            "lock-token",
            "request-hash-one",
            result,
        );

        expect(dynamoDb.send).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({
                    Key: { pk: "idem:tenant:key" },
                    UpdateExpression:
                        "SET #status = :completed, #result = :result",
                }),
            }),
        );
        expect(redis.set).toHaveBeenCalledWith(
            "idem:tenant:key",
            JSON.stringify({
                requestHash: "request-hash-one",
                result,
            }),
            { EX: 86_400 },
        );
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
        const dynamoDb = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    pk: "idem:tenant:key",
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                    status: "completed",
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
