import { afterEach, describe, expect, test, vi } from "vitest";

import {
    createInMemoryIdempotencyStore,
    createRedisIdempotencyStore,
    IdempotencyRequestMismatchError,
    toRedisLockKey,
    toRedisResultKey,
} from "./idempotencyStore.js";

afterEach(() => {
    vi.useRealTimers();
});

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
        expect(redis.set).toHaveBeenCalledWith("lock:tenant:key", token, {
            NX: true,
            PX: 30_000,
        });
    });

    void test("returns missing results and unavailable locks", async () => {
        const redis = createRedisMock({
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(null),
        });
        const store = createRedisIdempotencyStore(redis as never);

        await expect(
            store.getResult("tenant", "missing", "request-hash"),
        ).resolves.toBeUndefined();
        await expect(
            store.acquireLock("tenant", "key"),
        ).resolves.toBeUndefined();
    });

    void test("connects closed Redis clients and releases owned locks", async () => {
        const redis = createRedisMock({
            isOpen: false,
        });
        const store = createRedisIdempotencyStore(redis as never);

        const token = await store.acquireLock("tenant", "key");
        await store.releaseLock("tenant", "key", token as string);

        expect(redis.connect).toHaveBeenCalledTimes(2);
        expect(redis.eval).toHaveBeenCalledOnce();
    });
});

void describe("in-memory idempotency store", () => {
    void test("stores results and rejects mismatched request hashes", async () => {
        const store = createInMemoryIdempotencyStore();
        const result = { body: { id: "report-1" }, statusCode: 201 };

        await store.saveResult("tenant", "key", "request-hash-one", result);

        await expect(
            store.getResult("tenant", "key", "request-hash-one"),
        ).resolves.toEqual(result);
        await expect(
            store.getResult("tenant", "key", "request-hash-two"),
        ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);
        await expect(
            store.getResult("tenant", "missing", "request-hash-one"),
        ).resolves.toBeUndefined();
    });

    void test("expires completed results", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const store = createInMemoryIdempotencyStore();
        await store.saveResult("tenant", "key", "request-hash", {
            body: {},
            statusCode: 201,
        });

        vi.advanceTimersByTime(86_400_001);

        await expect(
            store.getResult("tenant", "key", "request-hash"),
        ).resolves.toBeUndefined();
    });

    void test("serializes locks until release or expiration", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        const store = createInMemoryIdempotencyStore();
        const token = await store.acquireLock("tenant", "key");

        await expect(
            store.acquireLock("tenant", "key"),
        ).resolves.toBeUndefined();
        await store.releaseLock("tenant", "key", "different-token");
        await expect(
            store.acquireLock("tenant", "key"),
        ).resolves.toBeUndefined();
        await store.releaseLock("tenant", "key", token as string);
        await expect(store.acquireLock("tenant", "key")).resolves.toEqual(
            expect.any(String),
        );

        vi.advanceTimersByTime(30_001);
        await expect(store.acquireLock("tenant", "key")).resolves.toEqual(
            expect.any(String),
        );

        store.clear();
        await expect(
            store.getResult("tenant", "key", "request-hash"),
        ).resolves.toBeUndefined();
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
