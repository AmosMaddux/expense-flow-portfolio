import {
    getDefaultStageTransitionEventPublisher,
    type StageTransitionEventPublisher,
} from "./stageTransitionEventPublisher.js";
import type { ExpenseReportStageTransitionedDataV1 } from "./expenseReportStageTransitioned.v1.js";
import {
    defaultStageTransitionOutboxStore,
    type ClaimedStageTransitionOutboxEvent,
    type StageTransitionOutboxStore,
} from "./stageTransitionOutboxRepository.js";

const defaultBatchSize = 25;
const defaultLeaseMilliseconds = 30_000;
const defaultMaxAttempts = 10;
const defaultPollIntervalMilliseconds = 5_000;
const maximumRetryDelayMilliseconds = 5 * 60_000;

export type StageTransitionOutboxDispatcherDependencies = {
    now?: () => Date;
    publisher?: StageTransitionEventPublisher;
    store?: StageTransitionOutboxStore;
};

export type StageTransitionOutboxDispatcher = {
    dispatch(eventId?: string): Promise<void>;
};

/**
 * Dispatches a specific event immediately or a batch of due outbox events.
 */
export async function dispatchStageTransitionOutboxEvents(
    eventId?: string,
    dependencies: StageTransitionOutboxDispatcherDependencies = {},
): Promise<void> {
    const now = dependencies.now ?? (() => new Date());
    const store = dependencies.store ?? defaultStageTransitionOutboxStore;
    const events = await store.claim({
        ...(eventId === undefined ? {} : { eventId }),
        leaseMilliseconds: defaultLeaseMilliseconds,
        limit: eventId === undefined ? defaultBatchSize : 1,
        maxAttempts: defaultMaxAttempts,
        now: now(),
    });

    for (const event of events) {
        await publishClaimedEvent(event, store, now, dependencies.publisher);
    }
}

/**
 * Starts the in-process retry dispatcher for pending stage-transition events.
 */
export function startStageTransitionOutboxDispatcher(
    dependencies: StageTransitionOutboxDispatcherDependencies = {},
): () => void {
    let isDispatching = false;
    const dispatchPending = () => {
        if (isDispatching) {
            return;
        }

        isDispatching = true;
        void dispatchStageTransitionOutboxEvents(undefined, dependencies)
            .catch(() => {
                // The next poll retries storage-level failures without failing the API process.
            })
            .finally(() => {
                isDispatching = false;
            });
    };
    const timer = setInterval(dispatchPending, defaultPollIntervalMilliseconds);
    timer.unref();
    dispatchPending();

    return () => {
        clearInterval(timer);
    };
}

async function publishClaimedEvent(
    event: ClaimedStageTransitionOutboxEvent,
    store: StageTransitionOutboxStore,
    now: () => Date,
    publisher?: StageTransitionEventPublisher,
): Promise<void> {
    try {
        const resolvedPublisher =
            publisher ?? getDefaultStageTransitionEventPublisher();
        await resolvedPublisher.publish({
            caseId: event.expenseReportId,
            tenantId: event.tenantId,
            fromStage:
                event.fromStage as ExpenseReportStageTransitionedDataV1["fromStage"],
            toStage:
                event.toStage as ExpenseReportStageTransitionedDataV1["toStage"],
            correlationId: event.correlationId,
            eventId: event.id,
            occurredAt: event.occurredAt,
        });
    } catch {
        const failedAt = now();
        const isDeadLettered = event.attemptCount >= defaultMaxAttempts;
        await store.markFailed(
            event,
            new Date(
                failedAt.getTime() +
                    calculateRetryDelayMilliseconds(event.attemptCount),
            ),
            isDeadLettered ? failedAt : undefined,
        );
        return;
    }

    await store.markPublished(event, now());
}

function calculateRetryDelayMilliseconds(attemptCount: number): number {
    return Math.min(
        2 ** Math.max(0, attemptCount - 1) * 1_000,
        maximumRetryDelayMilliseconds,
    );
}
