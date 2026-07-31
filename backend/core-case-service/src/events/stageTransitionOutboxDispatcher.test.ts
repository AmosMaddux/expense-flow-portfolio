import { describe, expect, test, vi } from "vitest";

import type { ClaimedStageTransitionOutboxEvent } from "./stageTransitionOutboxRepository.js";
import type { ExpenseReportStageTransitionedEvent } from "./expenseReportStageTransitioned.v1.js";
import { dispatchStageTransitionOutboxEvents } from "./stageTransitionOutboxDispatcher.js";
import type { StageTransitionOutboxStore } from "./stageTransitionOutboxRepository.js";

const claimedEvent: ClaimedStageTransitionOutboxEvent = {
    id: "90000000-0000-4000-8000-000000000001",
    stageTransitionId: "91000000-0000-4000-8000-000000000001",
    expenseReportId: "92000000-0000-4000-8000-000000000001",
    tenantId: "93000000-0000-4000-8000-000000000001",
    correlationId: "94000000-0000-4000-8000-000000000001",
    fromStage: "Drafted",
    toStage: "Submitted",
    occurredAt: new Date("2026-08-02T10:00:00.000Z"),
    lockId: "95000000-0000-4000-8000-000000000001",
    attemptCount: 1,
};

function buildDependencies(
    publish: (event: ExpenseReportStageTransitionedEvent) => Promise<void>,
) {
    const claimPending = vi
        .fn<StageTransitionOutboxStore["claimPending"]>()
        .mockResolvedValue([claimedEvent]);
    const markPublished = vi
        .fn<StageTransitionOutboxStore["markPublished"]>()
        .mockResolvedValue(undefined);
    const markFailed = vi
        .fn<StageTransitionOutboxStore["markFailed"]>()
        .mockResolvedValue(undefined);

    return {
        dependencies: {
            now: vi.fn(() => new Date("2026-08-02T10:01:00.000Z")),
            publisher: {
                publish,
            },
            store: {
                claimPending,
                markPublished,
                markFailed,
            },
        },
        claimPending,
        markPublished,
        markFailed,
    };
}

void describe("dispatchStageTransitionOutboxEvents", () => {
    void test("publishes claimed outbox rows and marks them sent", async () => {
        const publish = vi
            .fn<(event: ExpenseReportStageTransitionedEvent) => Promise<void>>()
            .mockResolvedValue(undefined);
        const { dependencies, claimPending, markPublished, markFailed } =
            buildDependencies(publish);

        const publishedCount = await dispatchStageTransitionOutboxEvents(
            claimedEvent.id,
            dependencies,
        );

        expect(publishedCount).toBe(1);
        expect(claimPending).toHaveBeenCalledWith(
            expect.objectContaining({
                eventId: claimedEvent.id,
                batchSize: 1,
                maxAttempts: 10,
            }),
        );
        const publishedEvent = publish.mock.calls[0]?.[0];

        expect(publishedEvent).toBeDefined();
        expect(publishedEvent?.id).toBe(claimedEvent.id);
        expect(publishedEvent?.type).toBe(
            "expense-report.stage-transitioned.v1",
        );
        expect(publishedEvent?.data).toMatchObject({
            caseId: claimedEvent.expenseReportId,
            tenantId: claimedEvent.tenantId,
            stageTransitionId: claimedEvent.stageTransitionId,
        });
        expect(markPublished).toHaveBeenCalledWith(
            claimedEvent.id,
            claimedEvent.lockId,
            new Date("2026-08-02T10:01:00.000Z"),
        );
        expect(markFailed).not.toHaveBeenCalled();
    });

    void test("releases a claimed outbox row for retry when publish fails", async () => {
        const publish = vi
            .fn<(event: ExpenseReportStageTransitionedEvent) => Promise<void>>()
            .mockRejectedValue(new Error("sns down"));
        const { dependencies, claimPending, markPublished, markFailed } =
            buildDependencies(publish);

        const publishedCount = await dispatchStageTransitionOutboxEvents(
            undefined,
            dependencies,
        );

        expect(publishedCount).toBe(0);
        expect(claimPending).toHaveBeenCalledWith(
            expect.objectContaining({
                batchSize: 25,
            }),
        );
        const claimRequest = claimPending.mock.calls[0]?.[0];

        expect(claimRequest).toBeDefined();
        expect(claimRequest).not.toHaveProperty("eventId");
        expect(markPublished).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledWith(
            claimedEvent.id,
            claimedEvent.lockId,
            new Date("2026-08-02T10:01:01.000Z"),
            undefined,
        );
    });
});
