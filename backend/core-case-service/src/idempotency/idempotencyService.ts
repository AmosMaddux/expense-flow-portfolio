import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

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
 * Replays completed submissions and serializes first writers per tenant key.
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
        const completed = await store.getResult(tenantId, idempotencyKey);
        if (completed !== undefined) {
            return completed;
        }

        throw new ConflictError(
            "A submission with this idempotency key is already in progress.",
        );
    }

    try {
        const completed = await store.getResult(tenantId, idempotencyKey);
        if (completed !== undefined) {
            return completed;
        }

        const body = toJsonSafeBody(await operation());
        const result = { body, statusCode: 201 };

        await store.saveResult(tenantId, idempotencyKey, result);

        return result;
    } catch (error: unknown) {
        if (error instanceof ConditionalCheckFailedException) {
            const completed = await store.getResult(tenantId, idempotencyKey);
            if (completed !== undefined) {
                return completed;
            }
        }

        throw error;
    } finally {
        await store.releaseLock(tenantId, idempotencyKey, lockToken);
    }
}

function toJsonSafeBody(body: unknown): unknown {
    return JSON.parse(JSON.stringify(body)) as unknown;
}
