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

    void test("does not run the operation when a durable reservation exists", async () => {
        const store = createStore({
            reserveSubmission: vi.fn().mockResolvedValue(false),
        });
        const operation = vi.fn();

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-2",
                operation,
                store,
                tenantId: "40000000-0000-4000-8000-000000000203",
            }),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(operation).not.toHaveBeenCalled();
    });

    void test("clears a failed reservation so the same submission can retry", async () => {
        const store = createStore({});
        const tenantId = "40000000-0000-4000-8000-000000000204";

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-3",
                operation: () => Promise.reject(new Error("synthetic failure")),
                store,
                tenantId,
            }),
        ).rejects.toThrow("synthetic failure");

        expect(store.clearReservation).toHaveBeenCalledWith(
            tenantId,
            "submit-3",
            "lock-token",
        );

        const retry = await runIdempotentSubmission({
            idempotencyKey: "submit-3",
            operation: () => Promise.resolve({ id: "retried-report" }),
            store,
            tenantId,
        });

        expect(retry).toEqual({
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
