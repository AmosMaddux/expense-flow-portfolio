import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { stageTransitionOutbox } from "../db/schema/index.js";

export type ClaimedStageTransitionOutboxEvent = {
    id: string;
    stageTransitionId: string;
    expenseReportId: string;
    tenantId: string;
    correlationId: string;
    fromStage: string;
    toStage: string;
    occurredAt: Date;
    lockId: string;
    attemptCount: number;
};

export type ClaimStageTransitionOutboxEventsRequest = {
    batchSize: number;
    leaseUntil: Date;
    now: Date;
    maxAttempts: number;
    eventId?: string;
};

export type StageTransitionOutboxStore = {
    claimPending(
        request: ClaimStageTransitionOutboxEventsRequest,
    ): Promise<ClaimedStageTransitionOutboxEvent[]>;
    markPublished(
        eventId: string,
        lockId: string,
        publishedAt: Date,
    ): Promise<void>;
    markFailed(
        eventId: string,
        lockId: string,
        nextAttemptAt: Date,
        deadLetteredAt?: Date,
    ): Promise<void>;
};

/**
 * Creates the default database store for the stage-transition outbox relay.
 */
export function createStageTransitionOutboxStore(): StageTransitionOutboxStore {
    return {
        claimPending,
        markPublished,
        markFailed,
    };
}

/**
 * Claims pending outbox rows with a short lease so multiple relays can run safely.
 */
export async function claimPending(
    request: ClaimStageTransitionOutboxEventsRequest,
): Promise<ClaimedStageTransitionOutboxEvent[]> {
    return db.transaction(async (transaction) => {
        const pendingRows = await transaction
            .select({ id: stageTransitionOutbox.id })
            .from(stageTransitionOutbox)
            .where(
                and(
                    isNull(stageTransitionOutbox.publishedAt),
                    isNull(stageTransitionOutbox.deadLetteredAt),
                    lte(stageTransitionOutbox.nextAttemptAt, request.now),
                    lt(stageTransitionOutbox.attemptCount, request.maxAttempts),
                    request.eventId === undefined
                        ? undefined
                        : eq(stageTransitionOutbox.id, request.eventId),
                    or(
                        isNull(stageTransitionOutbox.lockedUntil),
                        lte(stageTransitionOutbox.lockedUntil, request.now),
                    ),
                ),
            )
            .orderBy(asc(stageTransitionOutbox.nextAttemptAt))
            .limit(request.batchSize)
            .for("update", { skipLocked: true });
        const eventIds = pendingRows.map((row) => row.id);

        if (eventIds.length === 0) {
            return [];
        }

        const lockId = randomUUID();

        return transaction
            .update(stageTransitionOutbox)
            .set({
                lockId,
                lockedUntil: request.leaseUntil,
                attemptCount: sql`${stageTransitionOutbox.attemptCount} + 1`,
            })
            .where(inArray(stageTransitionOutbox.id, eventIds))
            .returning({
                id: stageTransitionOutbox.id,
                stageTransitionId: stageTransitionOutbox.stageTransitionId,
                expenseReportId: stageTransitionOutbox.expenseReportId,
                tenantId: stageTransitionOutbox.tenantId,
                correlationId: stageTransitionOutbox.correlationId,
                fromStage: stageTransitionOutbox.fromStage,
                toStage: stageTransitionOutbox.toStage,
                occurredAt: stageTransitionOutbox.occurredAt,
                lockId: sql<string>`${lockId}`,
                attemptCount: stageTransitionOutbox.attemptCount,
            });
    });
}

/**
 * Marks a leased outbox row as published after SNS accepts the event.
 */
export async function markPublished(
    eventId: string,
    lockId: string,
    publishedAt: Date,
): Promise<void> {
    await db
        .update(stageTransitionOutbox)
        .set({
            publishedAt,
            lockId: null,
            lockedUntil: null,
        })
        .where(
            and(
                eq(stageTransitionOutbox.id, eventId),
                eq(stageTransitionOutbox.lockId, lockId),
                isNull(stageTransitionOutbox.publishedAt),
            ),
        );
}

/**
 * Releases a leased outbox row after a failed publish attempt.
 */
export async function markFailed(
    eventId: string,
    lockId: string,
    nextAttemptAt: Date,
    deadLetteredAt?: Date,
): Promise<void> {
    await db
        .update(stageTransitionOutbox)
        .set({
            lockId: null,
            lockedUntil: null,
            nextAttemptAt,
            deadLetteredAt: deadLetteredAt ?? null,
        })
        .where(
            and(
                eq(stageTransitionOutbox.id, eventId),
                eq(stageTransitionOutbox.lockId, lockId),
                isNull(stageTransitionOutbox.publishedAt),
            ),
        );
}
