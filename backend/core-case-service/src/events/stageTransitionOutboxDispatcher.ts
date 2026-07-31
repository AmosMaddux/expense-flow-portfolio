import {
    buildExpenseReportStageTransitionedEvent,
    type ExpenseReportStageTransitionedEvent,
} from "./expenseReportStageTransitioned.v1.js";
import {
    createSnsStageTransitionEventPublisher,
    type StageTransitionEventPublisher,
} from "./stageTransitionEventPublisher.js";
import {
    createStageTransitionOutboxStore,
    type ClaimedStageTransitionOutboxEvent,
    type StageTransitionOutboxStore,
} from "./stageTransitionOutboxRepository.js";

const defaultBatchSize = 25;
const defaultLeaseMs = 30_000;
const defaultMaxAttempts = 10;
const defaultPollMs = 5_000;
const defaultMaximumRetryDelayMs = 300_000;

export type DispatchStageTransitionOutboxEventsDependencies = {
    store?: StageTransitionOutboxStore;
    publisher?: StageTransitionEventPublisher;
    now?: () => Date;
};

export type StartStageTransitionOutboxDispatcherDependencies =
    DispatchStageTransitionOutboxEventsDependencies & {
        pollMs?: number;
    };

/**
 * Publishes pending stage-transition outbox rows and marks successful rows sent.
 */
export async function dispatchStageTransitionOutboxEvents(
    eventId?: string,
    dependencies: DispatchStageTransitionOutboxEventsDependencies = {},
): Promise<number> {
    const store = dependencies.store ?? createStageTransitionOutboxStore();
    const publisher =
        dependencies.publisher ?? createSnsStageTransitionEventPublisher();
    const now = dependencies.now ?? (() => new Date());
    const claimTime = now();
    const claimRequest = {
        batchSize: eventId === undefined ? defaultBatchSize : 1,
        leaseUntil: new Date(claimTime.getTime() + defaultLeaseMs),
        now: claimTime,
        maxAttempts: defaultMaxAttempts,
        ...(eventId === undefined ? {} : { eventId }),
    };
    const events = await store.claimPending(claimRequest);
    let publishedCount = 0;

    for (const event of events) {
        const published = await publishClaimedEvent(
            event,
            store,
            publisher,
            now,
        );

        if (published) {
            publishedCount += 1;
        }
    }

    return publishedCount;
}

/**
 * Starts the polling relay for durable stage-transition outbox rows.
 */
export function startStageTransitionOutboxDispatcher(
    dependencies: StartStageTransitionOutboxDispatcherDependencies = {},
): NodeJS.Timeout {
    const pollMs = dependencies.pollMs ?? defaultPollMs;
    const run = () => {
        void dispatchStageTransitionOutboxEvents(undefined, dependencies).catch(
            (error: unknown) => {
                console.error(
                    error instanceof Error
                        ? error.message
                        : "Stage-transition outbox dispatch failed.",
                );
            },
        );
    };

    run();

    return setInterval(run, pollMs);
}

async function publishClaimedEvent(
    claimedEvent: ClaimedStageTransitionOutboxEvent,
    store: StageTransitionOutboxStore,
    publisher: StageTransitionEventPublisher,
    now: () => Date,
): Promise<boolean> {
    try {
        const event: ExpenseReportStageTransitionedEvent =
            buildExpenseReportStageTransitionedEvent({
                eventId: claimedEvent.id,
                expenseReportId: claimedEvent.expenseReportId,
                tenantId: claimedEvent.tenantId,
                stageTransitionId: claimedEvent.stageTransitionId,
                fromStage: claimedEvent.fromStage,
                toStage: claimedEvent.toStage,
                correlationId: claimedEvent.correlationId,
                occurredAt: claimedEvent.occurredAt,
            });

        await publisher.publish(event);
        await store.markPublished(claimedEvent.id, claimedEvent.lockId, now());

        return true;
    } catch {
        const failedAt = now();
        const shouldDeadLetter =
            claimedEvent.attemptCount >= defaultMaxAttempts;

        await store.markFailed(
            claimedEvent.id,
            claimedEvent.lockId,
            nextRetryAt(failedAt, claimedEvent.attemptCount),
            shouldDeadLetter ? failedAt : undefined,
        );

        return false;
    }
}

function nextRetryAt(failedAt: Date, attemptCount: number): Date {
    const retryDelayMs = Math.min(
        1_000 * 2 ** Math.max(attemptCount - 1, 0),
        defaultMaximumRetryDelayMs,
    );

    return new Date(failedAt.getTime() + retryDelayMs);
}
