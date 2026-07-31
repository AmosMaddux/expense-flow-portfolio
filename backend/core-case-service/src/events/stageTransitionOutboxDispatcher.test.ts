import { describe, expect, test, vi } from "vitest";

import type {
    ClaimedStageTransitionOutboxEvent,
    StageTransitionOutboxStore,
} from "./stageTransitionOutboxRepository.js";
import { dispatchStageTransitionOutboxEvents } from "./stageTransitionOutboxDispatcher.js";

const event: ClaimedStageTransitionOutboxEvent = {
    id: "40000000-0000-4000-8000-000000000011",
    tenantId: "10000000-0000-4000-8000-000000000011",
    expenseReportId: "30000000-0000-4000-8000-000000000011",
    correlationId: "50000000-0000-4000-8000-000000000011",
    fromStage: "Submitted",
    toStage: "Manager Approval",
    occurredAt: new Date("2026-07-29T18:00:00.000Z"),
    attemptCount: 1,
    lockId: "60000000-0000-4000-8000-000000000011",
};

function createStore(
    claimedEvents: ClaimedStageTransitionOutboxEvent[] = [event],
): StageTransitionOutboxStore & {
    claim: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    markPublished: ReturnType<typeof vi.fn>;
} {
    return {
        claim: vi.fn().mockResolvedValue(claimedEvents),
        markFailed: vi.fn().mockResolvedValue(undefined),
        markPublished: vi.fn().mockResolvedValue(undefined),
    };
}

void describe("stage-transition outbox dispatcher", () => {
    void test("publishes a claimed event exactly once and marks it complete", async () => {
        const store = createStore();
        const publish = vi.fn().mockResolvedValue(undefined);
        const publishedAt = new Date("2026-07-29T18:00:01.000Z");

        await dispatchStageTransitionOutboxEvents(event.id, {
            now: () => publishedAt,
            publisher: { publish },
            store,
        });

        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith({
            caseId: event.expenseReportId,
            tenantId: event.tenantId,
            fromStage: "Submitted",
            toStage: "Manager Approval",
            correlationId: event.correlationId,
            eventId: event.id,
            occurredAt: event.occurredAt,
        });
        expect(store.markPublished).toHaveBeenCalledWith(event, publishedAt);
        expect(store.markFailed).not.toHaveBeenCalled();
    });

    void test("retains an event for retry when SNS publishing fails", async () => {
        const store = createStore();
        const failedAt = new Date("2026-07-29T18:00:01.000Z");

        await expect(
            dispatchStageTransitionOutboxEvents(event.id, {
                now: () => failedAt,
                publisher: {
                    publish: vi
                        .fn()
                        .mockRejectedValue(new Error("synthetic SNS failure")),
                },
                store,
            }),
        ).resolves.toBeUndefined();

        expect(store.markPublished).not.toHaveBeenCalled();
        expect(store.markFailed).toHaveBeenCalledWith(
            event,
            new Date("2026-07-29T18:00:02.000Z"),
            undefined,
        );
    });

    void test("does not mark a published event failed when completion marking fails", async () => {
        const store = createStore();
        const publish = vi.fn().mockResolvedValue(undefined);
        store.markPublished.mockRejectedValue(
            new Error("synthetic stale completion"),
        );

        await expect(
            dispatchStageTransitionOutboxEvents(event.id, {
                now: () => new Date("2026-07-29T18:00:01.000Z"),
                publisher: { publish },
                store,
            }),
        ).rejects.toThrow("synthetic stale completion");

        expect(publish).toHaveBeenCalledTimes(1);
        expect(store.markPublished).toHaveBeenCalledTimes(1);
        expect(store.markFailed).not.toHaveBeenCalled();
    });

    void test("dead-letters an event after the final failed attempt", async () => {
        const finalAttemptEvent = { ...event, attemptCount: 10 };
        const store = createStore([finalAttemptEvent]);
        const failedAt = new Date("2026-07-29T18:00:01.000Z");

        await dispatchStageTransitionOutboxEvents(event.id, {
            now: () => failedAt,
            publisher: {
                publish: vi
                    .fn()
                    .mockRejectedValue(new Error("synthetic SNS failure")),
            },
            store,
        });

        expect(store.markFailed).toHaveBeenCalledWith(
            finalAttemptEvent,
            new Date("2026-07-29T18:05:01.000Z"),
            failedAt,
        );
    });
});
