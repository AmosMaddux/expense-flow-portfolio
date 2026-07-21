import { describe, expect, test, vi } from "vitest";

import { ConflictError } from "../errors/problem-json.js";
import {
    createIdempotencyRequestHash,
    createIdempotencyResourceId,
    runIdempotentSubmission,
} from "./idempotencyService.js";
import { IdempotencyRequestMismatchError } from "./idempotencyStore.js";

void describe("runIdempotentSubmission", () => {
    const requestHash = "synthetic-request-hash";

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
            requestHash,
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
                requestHash,
                store,
                tenantId: "40000000-0000-4000-8000-000000000203",
            }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    void test("does not run the operation when a non-recoverable reservation exists", async () => {
        const operation = vi.fn();
        const store = createStore({
            reserveSubmission: vi.fn().mockResolvedValue(false),
        });

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-3",
                operation,
                requestHash,
                store,
                tenantId: "40000000-0000-4000-8000-000000000204",
            }),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(operation).not.toHaveBeenCalled();
    });

    void test("recovers a stale create reservation with the stable resource id", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000210";
        const resourceId = createIdempotencyResourceId(tenantId, "submit-9");
        const operation = vi.fn().mockResolvedValue({ id: resourceId });
        const store = createStore({
            reserveSubmission: vi.fn().mockResolvedValue(false),
        });

        const result = await runIdempotentSubmission({
            idempotencyKey: "submit-9",
            operation,
            requestHash,
            reservationMetadata: {
                operation: "create_expense_report",
                resourceId,
                tenantId,
            },
            store,
            tenantId,
        });

        expect(result).toEqual({
            body: { id: resourceId },
            statusCode: 201,
        });
        expect(operation).toHaveBeenCalledOnce();
        expect(store.saveResult).toHaveBeenCalledWith(
            tenantId,
            "submit-9",
            "lock-token",
            requestHash,
            {
                body: { id: resourceId },
                statusCode: 201,
            },
        );
    });

    void test("rejects an idempotency key reused with a different request payload", async () => {
        const operation = vi.fn();
        const store = createStore({
            getResult: vi
                .fn()
                .mockRejectedValue(new IdempotencyRequestMismatchError()),
        });

        await expect(
            runIdempotentSubmission({
                idempotencyKey: "submit-7",
                operation,
                requestHash,
                store,
                tenantId: "40000000-0000-4000-8000-000000000208",
            }),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(operation).not.toHaveBeenCalled();
    });
});

void describe("createIdempotencyRequestHash", () => {
    void test("creates a canonical hash for request payloads", () => {
        const first = createIdempotencyRequestHash({
            dueDate: "2026-08-02",
            owner: "50000000-0000-4000-8000-000000000001",
            priority: "Normal",
        });
        const reordered = createIdempotencyRequestHash({
            priority: "Normal",
            owner: "50000000-0000-4000-8000-000000000001",
            dueDate: "2026-08-02",
        });
        const changed = createIdempotencyRequestHash({
            dueDate: "2026-08-03",
            owner: "50000000-0000-4000-8000-000000000001",
            priority: "Normal",
        });

        expect(reordered).toBe(first);
        expect(changed).not.toBe(first);
    });
});

void describe("createIdempotencyResourceId", () => {
    void test("scopes stable resource ids by tenant and key", () => {
        const first = createIdempotencyResourceId("tenant-a", "submit-1");

        expect(createIdempotencyResourceId("tenant-a", "submit-1")).toBe(
            first,
        );
        expect(createIdempotencyResourceId("tenant-b", "submit-1")).not.toBe(
            first,
        );
        expect(first).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });
});

function createStore(overrides: Partial<Parameters<typeof Object.assign>[0]>) {
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
