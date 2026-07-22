import { createHash } from "node:crypto";

import { ConflictError } from "../errors/problem-json.js";
import type {
    IdempotencyResult,
    IdempotencyStore,
} from "./idempotencyStore.js";
import { IdempotencyRequestMismatchError } from "./idempotencyStore.js";

type RunIdempotentSubmissionRequest<TBody> = {
    idempotencyKey: string;
    operation: () => Promise<TBody>;
    requestHash: string;
    store: IdempotencyStore;
    tenantId: string;
};

export type IdempotentSubmissionRunResult = IdempotencyResult & {
    replayed: boolean;
};

/**
 * Replays completed submissions and serializes first writers per tenant key.
 */
export async function runIdempotentSubmission<TBody>({
    idempotencyKey,
    operation,
    requestHash,
    store,
    tenantId,
}: RunIdempotentSubmissionRequest<TBody>): Promise<IdempotentSubmissionRunResult> {
    const cached = await getResultForRequest(
        store,
        tenantId,
        idempotencyKey,
        requestHash,
    );
    if (cached !== undefined) {
        return { ...cached, replayed: true };
    }

    const lockToken = await store.acquireLock(tenantId, idempotencyKey);
    if (lockToken === undefined) {
        const completed = await getResultForRequest(
            store,
            tenantId,
            idempotencyKey,
            requestHash,
        );
        if (completed !== undefined) {
            return { ...completed, replayed: true };
        }

        throw new ConflictError(
            "A submission with this idempotency key is already in progress.",
        );
    }

    try {
        const completed = await getResultForRequest(
            store,
            tenantId,
            idempotencyKey,
            requestHash,
        );
        if (completed !== undefined) {
            return { ...completed, replayed: true };
        }

        const body = toJsonSafeBody(await operation());
        const result = { body, statusCode: 201 };

        await store.saveResult(
            tenantId,
            idempotencyKey,
            requestHash,
            result,
        );

        return { ...result, replayed: false };
    } finally {
        await releaseLockAfterSubmission(
            store,
            tenantId,
            idempotencyKey,
            lockToken,
        );
    }
}

/**
 * Creates a stable SHA-256 fingerprint for an idempotent request payload.
 */
export function createIdempotencyRequestHash(payload: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(toCanonicalJsonValue(payload)))
        .digest("hex");
}

async function getResultForRequest(
    store: IdempotencyStore,
    tenantId: string,
    idempotencyKey: string,
    requestHash: string,
): Promise<IdempotencyResult | undefined> {
    try {
        return await store.getResult(tenantId, idempotencyKey, requestHash);
    } catch (error: unknown) {
        if (error instanceof IdempotencyRequestMismatchError) {
            throw new ConflictError(error.message);
        }

        throw error;
    }
}

async function releaseLockAfterSubmission(
    store: IdempotencyStore,
    tenantId: string,
    idempotencyKey: string,
    lockToken: string,
): Promise<void> {
    try {
        await store.releaseLock(tenantId, idempotencyKey, lockToken);
    } catch (error: unknown) {
        console.error("Failed to release idempotency lock.", {
            error,
            idempotencyKey,
            tenantId,
        });
    }
}

function toJsonSafeBody(body: unknown): unknown {
    return JSON.parse(JSON.stringify(body)) as unknown;
}

function toCanonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(toCanonicalJsonValue);
    }

    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, childValue]) => childValue !== undefined)
                .sort(([leftKey], [rightKey]) =>
                    leftKey.localeCompare(rightKey),
                )
                .map(([key, childValue]) => [
                    key,
                    toCanonicalJsonValue(childValue),
                ]),
        );
    }

    return value;
}
