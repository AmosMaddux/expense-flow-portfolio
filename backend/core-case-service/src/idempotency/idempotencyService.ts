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
    reservationMetadata?: Record<string, unknown>;
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
    reservationMetadata,
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

    let shouldClearReservation = false;

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

        const reserved = await store.reserveSubmission(
            tenantId,
            idempotencyKey,
            lockToken,
            requestHash,
            reservationMetadata,
        );
        if (!reserved) {
            const reservedResult = await getResultForRequest(
                store,
                tenantId,
                idempotencyKey,
                requestHash,
            );
            if (reservedResult !== undefined) {
                return { ...reservedResult, replayed: true };
            }

            if (isRecoverableCreateReservation(reservationMetadata)) {
                const body = toJsonSafeBody(await operation());
                const result = { body, statusCode: 201 };
                await store.saveResult(
                    tenantId,
                    idempotencyKey,
                    lockToken,
                    requestHash,
                    result,
                );
                return { ...result, replayed: false };
            }

            throw new ConflictError(
                "A submission with this idempotency key is already in progress.",
            );
        }
        shouldClearReservation = true;

        const body = toJsonSafeBody(await operation());
        shouldClearReservation = false;

        const result = { body, statusCode: 201 };

        await store.saveResult(
            tenantId,
            idempotencyKey,
            lockToken,
            requestHash,
            result,
        );

        return { ...result, replayed: false };
    } catch (error: unknown) {
        if (shouldClearReservation) {
            await store.clearReservation(tenantId, idempotencyKey, lockToken);
        }

        throw error;
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

/**
 * Creates a stable UUID for a tenant-scoped idempotent create operation.
 */
export function createIdempotencyResourceId(
    tenantId: string,
    idempotencyKey: string,
): string {
    const hex = createHash("sha256")
        .update(`${tenantId}:${idempotencyKey}`)
        .digest("hex")
        .slice(0, 32)
        .split("");

    hex[12] = "4";
    const variant = Number.parseInt(hex[16] ?? "0", 16);
    hex[16] = ((variant & 0x3) | 0x8).toString(16);

    const uuid = hex.join("");
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
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

function isRecoverableCreateReservation(
    metadata: Record<string, unknown> | undefined,
): boolean {
    return (
        metadata !== undefined &&
        metadata.operation === "create_expense_report" &&
        typeof metadata.resourceId === "string"
    );
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
