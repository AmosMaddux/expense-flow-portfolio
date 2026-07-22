import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";

export const IDEMPOTENCY_RESULT_TTL_SECONDS = 24 * 60 * 60;
export const IDEMPOTENCY_LOCK_TTL_MILLISECONDS = 30 * 1000;

export type IdempotencyResult = {
    body: unknown;
    statusCode: number;
};

/**
 * Represents an idempotency key reused with a different request payload.
 */
export class IdempotencyRequestMismatchError extends Error {
    public constructor() {
        super("Idempotency key was reused with a different request payload.");
        this.name = "IdempotencyRequestMismatchError";
    }
}

export type IdempotencyStore = {
    acquireLock: (
        tenantId: string,
        idempotencyKey: string,
    ) => Promise<string | undefined>;
    getResult: (
        tenantId: string,
        idempotencyKey: string,
        requestHash: string,
    ) => Promise<IdempotencyResult | undefined>;
    releaseLock: (
        tenantId: string,
        idempotencyKey: string,
        token: string,
    ) => Promise<void>;
    saveResult: (
        tenantId: string,
        idempotencyKey: string,
        requestHash: string,
        result: IdempotencyResult,
    ) => Promise<void>;
};

type CachedIdempotencyRecord = {
    requestHash: string;
    result: IdempotencyResult;
};

type LockRecord = {
    token: string;
    expiresAt: number;
};

type MemoryRecord = CachedIdempotencyRecord & {
    expiresAt: number;
};

/**
 * Stores completed idempotency results and active locks in Redis.
 */
export function createRedisIdempotencyStore(
    redis: RedisClientType,
): IdempotencyStore {
    return {
        async acquireLock(tenantId, idempotencyKey) {
            await connectRedis(redis);

            const token = randomUUID();
            const lock = await redis.set(
                toRedisLockKey(tenantId, idempotencyKey),
                token,
                {
                    NX: true,
                    PX: IDEMPOTENCY_LOCK_TTL_MILLISECONDS,
                },
            );

            return lock === "OK" ? token : undefined;
        },
        async getResult(tenantId, idempotencyKey, requestHash) {
            await connectRedis(redis);

            const cached = await redis.get(
                toRedisResultKey(tenantId, idempotencyKey),
            );
            if (cached === null) {
                return undefined;
            }

            const cachedRecord = JSON.parse(cached) as CachedIdempotencyRecord;
            if (cachedRecord.requestHash !== requestHash) {
                throw new IdempotencyRequestMismatchError();
            }

            return cachedRecord.result;
        },
        async releaseLock(tenantId, idempotencyKey, token) {
            await connectRedis(redis);

            await redis.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                {
                    keys: [toRedisLockKey(tenantId, idempotencyKey)],
                    arguments: [token],
                },
            );
        },
        async saveResult(tenantId, idempotencyKey, requestHash, result) {
            await connectRedis(redis);

            await redis.set(
                toRedisResultKey(tenantId, idempotencyKey),
                JSON.stringify({
                    requestHash,
                    result,
                } satisfies CachedIdempotencyRecord),
                {
                    EX: IDEMPOTENCY_RESULT_TTL_SECONDS,
                },
            );
        },
    };
}

/**
 * Provides the same Redis idempotency semantics for local tests.
 */
export function createInMemoryIdempotencyStore(): IdempotencyStore & {
    clear(): void;
} {
    const records = new Map<string, MemoryRecord>();
    const locks = new Map<string, LockRecord>();

    return {
        async acquireLock(tenantId, idempotencyKey) {
            const lockKey = toRedisLockKey(tenantId, idempotencyKey);
            const now = Date.now();
            const existing = locks.get(lockKey);

            if (existing !== undefined && existing.expiresAt > now) {
                return undefined;
            }

            const token = randomUUID();
            locks.set(lockKey, {
                token,
                expiresAt: now + IDEMPOTENCY_LOCK_TTL_MILLISECONDS,
            });
            return token;
        },
        clear() {
            locks.clear();
            records.clear();
        },
        async getResult(tenantId, idempotencyKey, requestHash) {
            const key = toRedisResultKey(tenantId, idempotencyKey);
            const record = records.get(key);

            if (record === undefined) {
                return undefined;
            }

            if (record.expiresAt <= Date.now()) {
                records.delete(key);
                return undefined;
            }

            if (record.requestHash !== requestHash) {
                throw new IdempotencyRequestMismatchError();
            }

            return record.result;
        },
        async releaseLock(tenantId, idempotencyKey, token) {
            const lockKey = toRedisLockKey(tenantId, idempotencyKey);
            const lock = locks.get(lockKey);

            if (lock?.token === token) {
                locks.delete(lockKey);
            }
        },
        async saveResult(tenantId, idempotencyKey, requestHash, result) {
            records.set(toRedisResultKey(tenantId, idempotencyKey), {
                requestHash,
                result,
                expiresAt:
                    Date.now() + IDEMPOTENCY_RESULT_TTL_SECONDS * 1000,
            });
        },
    };
}

/**
 * Builds the tenant-scoped Redis key for a completed idempotency result.
 */
export function toRedisResultKey(
    tenantId: string,
    idempotencyKey: string,
): string {
    return `idem:${tenantId}:${idempotencyKey}`;
}

/**
 * Builds the tenant-scoped Redis key for an active idempotency lock.
 */
export function toRedisLockKey(
    tenantId: string,
    idempotencyKey: string,
): string {
    return `lock:${tenantId}:${idempotencyKey}`;
}

async function connectRedis(redis: RedisClientType): Promise<void> {
    if (!redis.isOpen) {
        await redis.connect();
    }
}
