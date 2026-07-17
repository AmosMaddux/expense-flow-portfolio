import { ConflictError } from "../errors/problem-json.js";
import type {
    IdempotencyResult,
    IdempotencyStore,
} from "./idempotencyStore.js";

type RunIdempotentSubmissionRequest<TBody> = {
    idempotencyKey: string;
    operation: () => Promise<TBody>;
    store: IdempotencyStore;
    tenantId: string;
};

/**
 * Replays completed submissions and reserves a tenant key before side effects.
 */
export async function runIdempotentSubmission<TBody>({
    idempotencyKey,
    operation,
    store,
    tenantId,
}: RunIdempotentSubmissionRequest<TBody>): Promise<IdempotencyResult> {
    const cached = await store.getResult(tenantId, idempotencyKey);
    if (cached !== undefined) {
        return cached;
    }

    const lockToken = await store.acquireLock(tenantId, idempotencyKey);
    if (lockToken === undefined) {
        return await readCompletedOrConflict(store, tenantId, idempotencyKey);
    }

    let reservationToken: string | undefined;
    try {
        const completed = await store.getResult(tenantId, idempotencyKey);
        if (completed !== undefined) {
            return completed;
        }

        const reserved = await store.reserveSubmission(
            tenantId,
            idempotencyKey,
            lockToken,
        );
        if (!reserved) {
            return await readCompletedOrConflict(
                store,
                tenantId,
                idempotencyKey,
            );
        }
        reservationToken = lockToken;

        const result = {
            body: toJsonSafeBody(await operation()),
            statusCode: 201,
        };
        await store.saveResult(tenantId, idempotencyKey, lockToken, result);
        reservationToken = undefined;

        return result;
    } catch (error: unknown) {
        if (reservationToken !== undefined) {
            await store.clearReservation(
                tenantId,
                idempotencyKey,
                reservationToken,
            );
        }

        throw error;
    } finally {
        await store.releaseLock(tenantId, idempotencyKey, lockToken);
    }
}

async function readCompletedOrConflict(
    store: IdempotencyStore,
    tenantId: string,
    idempotencyKey: string,
): Promise<IdempotencyResult> {
    const completed = await store.getResult(tenantId, idempotencyKey);
    if (completed !== undefined) {
        return completed;
    }

    throw new ConflictError(
        "A submission with this idempotency key is already in progress.",
    );
}

function toJsonSafeBody(body: unknown): unknown {
    return JSON.parse(JSON.stringify(body)) as unknown;
}
