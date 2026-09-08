import { describe, expect, test, vi } from "vitest";

import type {
    ClaimedStageTransitionOutboxEvent,
    StageTransitionOutboxStore,
} from "./stageTransitionOutboxRepository.js";
import {
    dispatchStageTransitionOutboxEvents,
    StageTransitionOutboxOwnershipLostError,
} from "./stageTransitionOutboxDispatcher.js";

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
): {
    claim: ReturnType<typeof vi.fn<StageTransitionOutboxStore["claim"]>>;
    markFailed: ReturnType<
        typeof vi.fn<StageTransitionOutboxStore["markFailed"]>
    >;
    markPublished: ReturnType<
        typeof vi.fn<StageTransitionOutboxStore["markPublished"]>
    >;
    store: StageTransitionOutboxStore;
} {
    const claim = vi
        .fn<StageTransitionOutboxStore["claim"]>()
        .mockResolvedValue(claimedEvents);
    const markFailed = vi
        .fn<StageTransitionOutboxStore["markFailed"]>()
        .mockResolvedValue(true);
    const markPublished = vi
        .fn<StageTransitionOutboxStore["markPublished"]>()
        .mockResolvedValue(true);
    return {
        claim,
        markFailed,
        markPublished,
        store: {
            claim,
            markFailed,
            markPublished,
        },
    };
}

void describe("stage-transition outbox dispatcher", () => {
    void test("publishes a claimed event exactly once and marks it complete", async () => {
        const { markFailed, markPublished, store } = createStore();
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
        expect(markPublished).toHaveBeenCalledWith(event, publishedAt);
        expect(markFailed).not.toHaveBeenCalled();
    });

    void test("retains an event for retry when SNS publishing fails", async () => {
        const { markFailed, markPublished, store } = createStore();
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

        expect(markPublished).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledWith(
            event,
            new Date("2026-07-29T18:00:02.000Z"),
            undefined,
        );
    });

    void test("does not mark a published event failed when completion marking fails", async () => {
        const { markFailed, markPublished, store } = createStore();
        const publish = vi.fn().mockResolvedValue(undefined);
        markPublished.mockRejectedValue(
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
        expect(markPublished).toHaveBeenCalledTimes(1);
        expect(markFailed).not.toHaveBeenCalled();
    });

    void test("reports stale ownership when publishing cannot be marked complete", async () => {
        const { markFailed, markPublished, store } = createStore();
        const publish = vi.fn().mockResolvedValue(undefined);
        markPublished.mockResolvedValue(false);

        await expect(
            dispatchStageTransitionOutboxEvents(event.id, {
                now: () => new Date("2026-07-29T18:00:01.000Z"),
                publisher: { publish },
                store,
            }),
        ).rejects.toBeInstanceOf(StageTransitionOutboxOwnershipLostError);

        expect(publish).toHaveBeenCalledTimes(1);
        expect(markPublished).toHaveBeenCalledTimes(1);
        expect(markFailed).not.toHaveBeenCalled();
    });

    void test("reports stale ownership when a publish failure cannot be marked failed", async () => {
        const { markFailed, markPublished, store } = createStore();
        markFailed.mockResolvedValue(false);

        await expect(
            dispatchStageTransitionOutboxEvents(event.id, {
                now: () => new Date("2026-07-29T18:00:01.000Z"),
                publisher: {
                    publish: vi
                        .fn()
                        .mockRejectedValue(new Error("synthetic SNS failure")),
                },
                store,
            }),
        ).rejects.toBeInstanceOf(StageTransitionOutboxOwnershipLostError);

        expect(markPublished).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledTimes(1);
    });

    void test("dead-letters an event after the final failed attempt", async () => {
        const finalAttemptEvent = { ...event, attemptCount: 10 };
        const { markFailed, store } = createStore([finalAttemptEvent]);
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

        expect(markFailed).toHaveBeenCalledWith(
            finalAttemptEvent,
            new Date("2026-07-29T18:05:01.000Z"),
            failedAt,
        );
    });
});
