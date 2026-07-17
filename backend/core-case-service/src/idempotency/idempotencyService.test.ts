import { describe, expect, test, vi } from "vitest";

import { ConflictError } from "../errors/problem-json.js";
import { runIdempotentSubmission } from "./idempotencyService.js";
import type { IdempotencyStore } from "./idempotencyStore.js";

void describe("runIdempotentSubmission", () => {
    void test("returns a completed result without running the operation", async () => {
        const store = createStore({
            getResult: vi.fn().mockResolvedValue({
                body: { id: "cached-report" },
                statusCode: 201,
            }),
        });
        const operation = vi.fn();

        const result = await runIdempotentSubmission({
            idempotencyKey: "submit-1",
            operation,
            store,
            tenantId: "40000000-0000-4000-8000-000000000202",
        });

        expect(result).toEqual({
            body: { id: "cached-report" },
            statusCode: 201,
        });
        expect(operation).not.toHaveBeenCalled();
    });

    void test("rejects a concurrent submission when no result is ready", async () => {
        const store = createStore({
            acquireLock: vi.fn().mockResolvedValue(undefined),
            getResult: vi.fn().mockResolvedValue(undefined),
        });

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-2",
                operation: vi.fn(),
                store,
                tenantId: "40000000-0000-4000-8000-000000000203",
            }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    void test("does not run the operation when a durable reservation already exists", async () => {
        const operation = vi.fn();
        const store = createStore({
            reserveSubmission: vi.fn().mockResolvedValue(false),
        });

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-3",
                operation,
                store,
                tenantId: "40000000-0000-4000-8000-000000000204",
            }),
        ).rejects.toBeInstanceOf(ConflictError);

        expect(operation).not.toHaveBeenCalled();
    });

    void test("stores the original result as a JSON-safe response body", async () => {
        const store = createStore({});
        const createdAt = new Date("2026-08-01T12:00:00.000Z");

        const result = await runIdempotentSubmission({
            idempotencyKey: "submit-4",
            operation: () => Promise.resolve({ createdAt }),
            store,
            tenantId: "40000000-0000-4000-8000-000000000205",
        });

        expect(result.body).toEqual({ createdAt: "2026-08-01T12:00:00.000Z" });
        expect(store.saveResult).toHaveBeenCalledWith(
            "40000000-0000-4000-8000-000000000205",
            "submit-4",
            "lock-token",
            {
                body: { createdAt: "2026-08-01T12:00:00.000Z" },
                statusCode: 201,
            },
        );
    });

    void test("clears a failed reservation so the same submission can retry", async () => {
        const store = createStore({});
        const firstOperation = vi
            .fn()
            .mockRejectedValue(new Error("synthetic create failure"));
        const tenantId = "40000000-0000-4000-8000-000000000206";

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-5",
                operation: firstOperation,
                store,
                tenantId,
            }),
        ).rejects.toThrow("synthetic create failure");

        expect(store.clearReservation).toHaveBeenCalledWith(
            tenantId,
            "submit-5",
            "lock-token",
        );

        const retryResult = await runIdempotentSubmission({
            idempotencyKey: "submit-5",
            operation: () => Promise.resolve({ id: "retried-report" }),
            store,
            tenantId,
        });

        expect(retryResult).toEqual({
            body: { id: "retried-report" },
            statusCode: 201,
        });
        expect(store.reserveSubmission).toHaveBeenCalledTimes(2);
    });
});

function createStore(overrides: Partial<IdempotencyStore>): IdempotencyStore {
    return {
        acquireLock: vi.fn().mockResolvedValue("lock-token"),
        clearReservation: vi.fn().mockResolvedValue(undefined),
        getResult: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        reserveSubmission: vi.fn().mockResolvedValue(true),
        saveResult: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
