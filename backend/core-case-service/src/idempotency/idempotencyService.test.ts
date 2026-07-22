import { describe, expect, test, vi } from "vitest";

import { ConflictError } from "../errors/problem-json.js";
import {
    createIdempotencyRequestHash,
    runIdempotentSubmission,
} from "./idempotencyService.js";
import {
    IdempotencyRequestMismatchError,
    type IdempotencyStore,
} from "./idempotencyStore.js";

void describe("runIdempotentSubmission", () => {
    const requestHash = "synthetic-request-hash";

    void test("returns a completed Redis result without running the operation", async () => {
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
            replayed: true,
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

    void test("stores the original result as a JSON-safe Redis response body", async () => {
        const store = createStore({});
        const createdAt = new Date("2026-08-01T12:00:00.000Z");

        const result = await runIdempotentSubmission({
            idempotencyKey: "submit-4",
            operation: () => Promise.resolve({ createdAt }),
            requestHash,
            store,
            tenantId: "40000000-0000-4000-8000-000000000205",
        });

        expect(result).toMatchObject({
            body: { createdAt: "2026-08-01T12:00:00.000Z" },
            replayed: false,
            statusCode: 201,
        });
        expect(store.saveResult).toHaveBeenCalledWith(
            "40000000-0000-4000-8000-000000000205",
            "submit-4",
            requestHash,
            {
                body: { createdAt: "2026-08-01T12:00:00.000Z" },
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

    void test("returns a saved result when lock release cleanup fails", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const store = createStore({
            releaseLock: vi
                .fn()
                .mockRejectedValue(new Error("synthetic Redis failure")),
        });

        try {
            const result = await runIdempotentSubmission({
                idempotencyKey: "submit-8",
                operation: () => Promise.resolve({ id: "created-report" }),
                requestHash,
                store,
                tenantId: "40000000-0000-4000-8000-000000000209",
            });

            expect(result).toEqual({
                body: { id: "created-report" },
                replayed: false,
                statusCode: 201,
            });
            expect(store.saveResult).toHaveBeenCalledOnce();
            expect(consoleError).toHaveBeenCalledWith(
                "Failed to release idempotency lock.",
                expect.objectContaining({
                    idempotencyKey: "submit-8",
                    tenantId: "40000000-0000-4000-8000-000000000209",
                }),
            );
        } finally {
            consoleError.mockRestore();
        }
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

function createStore(overrides: Partial<IdempotencyStore>): IdempotencyStore {
    return {
        acquireLock: vi.fn().mockResolvedValue("lock-token"),
        getResult: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        saveResult: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
