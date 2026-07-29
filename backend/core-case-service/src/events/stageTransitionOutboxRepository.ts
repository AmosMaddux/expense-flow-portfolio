import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { stageTransitionOutbox } from "../db/schema/expenseReport.js";

export type ClaimedStageTransitionOutboxEvent = {
    id: string;
    tenantId: string;
    expenseReportId: string;
    correlationId: string;
    fromStage: string;
    toStage: string;
    occurredAt: Date;
    attemptCount: number;
    lockId: string;
};

export type ClaimStageTransitionOutboxEventsRequest = {
    eventId?: string;
    leaseMilliseconds: number;
    limit: number;
    maxAttempts: number;
    now: Date;
};

export type StageTransitionOutboxStore = {
    claim(
        request: ClaimStageTransitionOutboxEventsRequest,
    ): Promise<ClaimedStageTransitionOutboxEvent[]>;
    markFailed(
        event: ClaimedStageTransitionOutboxEvent,
        nextAttemptAt: Date,
        deadLetteredAt?: Date,
    ): Promise<void>;
    markPublished(
        event: ClaimedStageTransitionOutboxEvent,
        publishedAt: Date,
    ): Promise<void>;
};

/**
 * Claims due outbox events with a lease so concurrent dispatchers cannot publish the same attempt.
 */
export async function claimStageTransitionOutboxEvents(
    request: ClaimStageTransitionOutboxEventsRequest,
): Promise<ClaimedStageTransitionOutboxEvent[]> {
    return db.transaction(async (transaction) => {
        const candidates = await transaction
            .select({ id: stageTransitionOutbox.id })
            .from(stageTransitionOutbox)
            .where(
                and(
                    isNull(stageTransitionOutbox.publishedAt),
                    isNull(stageTransitionOutbox.deadLetteredAt),
                    lte(stageTransitionOutbox.nextAttemptAt, request.now),
                    lt(stageTransitionOutbox.attemptCount, request.maxAttempts),
                    or(
                        isNull(stageTransitionOutbox.lockedUntil),
                        lte(stageTransitionOutbox.lockedUntil, request.now),
                    ),
                    request.eventId === undefined
                        ? undefined
                        : eq(stageTransitionOutbox.id, request.eventId),
                ),
            )
            .orderBy(asc(stageTransitionOutbox.nextAttemptAt))
            .limit(request.limit)
            .for("update", { skipLocked: true });
        const ids = candidates.map((candidate) => candidate.id);
        if (ids.length === 0) {
            return [];
        }

        const lockId = randomUUID();
        const lockedUntil = new Date(
            request.now.getTime() + request.leaseMilliseconds,
        );
        const claimed = await transaction
            .update(stageTransitionOutbox)
            .set({
                attemptCount: sql`${stageTransitionOutbox.attemptCount} + 1`,
                lockId,
                lockedUntil,
            })
            .where(inArray(stageTransitionOutbox.id, ids))
            .returning({
                id: stageTransitionOutbox.id,
                tenantId: stageTransitionOutbox.tenantId,
                expenseReportId: stageTransitionOutbox.expenseReportId,
                correlationId: stageTransitionOutbox.correlationId,
                fromStage: stageTransitionOutbox.fromStage,
                toStage: stageTransitionOutbox.toStage,
                occurredAt: stageTransitionOutbox.occurredAt,
                attemptCount: stageTransitionOutbox.attemptCount,
            });

        return claimed.map((event) => ({ ...event, lockId }));
    });
}

/**
 * Marks a claimed outbox event as published.
 */
export async function markStageTransitionOutboxEventPublished(
    event: ClaimedStageTransitionOutboxEvent,
    publishedAt: Date,
): Promise<void> {
    await db
        .update(stageTransitionOutbox)
        .set({
            lockId: null,
            lockedUntil: null,
            publishedAt,
        })
        .where(
            and(
                eq(stageTransitionOutbox.id, event.id),
                eq(stageTransitionOutbox.lockId, event.lockId),
                isNull(stageTransitionOutbox.publishedAt),
            ),
        );
}

/**
 * Releases a failed outbox event for retry or marks it dead-lettered.
 */
export async function markStageTransitionOutboxEventFailed(
    event: ClaimedStageTransitionOutboxEvent,
    nextAttemptAt: Date,
    deadLetteredAt?: Date,
): Promise<void> {
    await db
        .update(stageTransitionOutbox)
        .set({
            lockId: null,
            lockedUntil: null,
            nextAttemptAt,
            ...(deadLetteredAt === undefined ? {} : { deadLetteredAt }),
        })
        .where(
            and(
                eq(stageTransitionOutbox.id, event.id),
                eq(stageTransitionOutbox.lockId, event.lockId),
                isNull(stageTransitionOutbox.publishedAt),
            ),
        );
}

export const defaultStageTransitionOutboxStore: StageTransitionOutboxStore = {
    claim: claimStageTransitionOutboxEvents,
    markFailed: markStageTransitionOutboxEventFailed,
    markPublished: markStageTransitionOutboxEventPublished,
};
