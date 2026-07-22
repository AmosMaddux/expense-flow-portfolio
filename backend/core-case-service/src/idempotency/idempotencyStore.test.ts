import { describe, expect, test, vi } from "vitest";

import {
    createRedisIdempotencyStore,
    IdempotencyRequestMismatchError,
    toRedisLockKey,
    toRedisResultKey,
} from "./idempotencyStore.js";

void describe("idempotency key builders", () => {
    void test("scopes Redis keys by tenant", () => {
        const tenantId = "40000000-0000-4000-8000-000000000201";
        const idempotencyKey = "expense-submit-1";

        expect(toRedisResultKey(tenantId, idempotencyKey)).toBe(
            "idem:40000000-0000-4000-8000-000000000201:expense-submit-1",
        );
        expect(toRedisLockKey(tenantId, idempotencyKey)).toBe(
            "lock:40000000-0000-4000-8000-000000000201:expense-submit-1",
        );
    });
});

void describe("idempotency store", () => {
    void test("stores completed results in Redis for 24 hours", async () => {
        const redis = createRedisMock();
        const store = createRedisIdempotencyStore(redis as never);
        const result = { body: { id: "report-1" }, statusCode: 201 };

        await store.saveResult("tenant", "key", "request-hash-one", result);

        expect(redis.set).toHaveBeenCalledWith(
            "idem:tenant:key",
            JSON.stringify({
                requestHash: "request-hash-one",
                result,
            }),
            { EX: 86_400 },
        );
    });

    void test("returns cached Redis results for the same request hash", async () => {
        const redis = createRedisMock({
            get: vi.fn().mockResolvedValue(
                JSON.stringify({
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                }),
            ),
        });
        const store = createRedisIdempotencyStore(redis as never);

        await expect(
            store.getResult("tenant", "key", "request-hash-one"),
        ).resolves.toEqual({
            body: { id: "report-1" },
            statusCode: 201,
        });
    });

    void test("rejects cached results for a different request hash", async () => {
        const redis = createRedisMock({
            get: vi.fn().mockResolvedValue(
                JSON.stringify({
                    requestHash: "request-hash-one",
                    result: { body: { id: "report-1" }, statusCode: 201 },
                }),
            ),
        });
        const store = createRedisIdempotencyStore(redis as never);

        await expect(
            store.getResult("tenant", "key", "request-hash-two"),
        ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);
    });

    void test("uses a short Redis lock to serialize concurrent retries", async () => {
        const redis = createRedisMock();
        const store = createRedisIdempotencyStore(redis as never);

        const token = await store.acquireLock("tenant", "key");

        expect(token).toEqual(expect.any(String));
        expect(redis.set).toHaveBeenCalledWith(
            "lock:tenant:key",
            token,
            {
                NX: true,
                PX: 30_000,
            },
        );
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
