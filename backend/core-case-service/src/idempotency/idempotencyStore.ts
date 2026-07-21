import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
    DeleteCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
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

export type IdempotencyReservationMetadata = Record<string, unknown>;

export type IdempotencyStore = {
    acquireLock: (
        tenantId: string,
        idempotencyKey: string,
    ) => Promise<string | undefined>;
    clearReservation: (
        tenantId: string,
        idempotencyKey: string,
        token: string,
    ) => Promise<void>;
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
    reserveSubmission: (
        tenantId: string,
        idempotencyKey: string,
        token: string,
        requestHash: string,
        metadata?: IdempotencyReservationMetadata,
    ) => Promise<boolean>;
    saveResult: (
        tenantId: string,
        idempotencyKey: string,
        token: string,
        requestHash: string,
        result: IdempotencyResult,
    ) => Promise<void>;
};

type DynamoIdempotencyRecord = {
    requestHash: string;
    result?: IdempotencyResult;
    status: "in_progress" | "completed";
    submissionToken: string;
    ttl: number;
} & IdempotencyReservationMetadata;

type IdempotencyRecord = {
    requestHash: string;
    result?: IdempotencyResult;
    status: "in_progress" | "completed";
    submissionToken: string;
    ttl: number;
} & IdempotencyReservationMetadata;

type LockRecord = {
    token: string;
    expiresAt: number;
};

/**
 * Local test/default implementation with DynamoDB-like records and Redis-like locks.
 */
export function createInMemoryIdempotencyStore(): IdempotencyStore & {
    clear(): void;
} {
    const records = new Map<string, IdempotencyRecord>();
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
        async clearReservation(tenantId, idempotencyKey, token) {
            const key = toDynamoPartitionKey(tenantId, idempotencyKey);
            const record = records.get(key);

            if (
                record?.status === "in_progress" &&
                record.submissionToken === token
            ) {
                records.delete(key);
            }
        },
        clear() {
            locks.clear();
            records.clear();
        },
        async getResult(tenantId, idempotencyKey, requestHash) {
            const key = toDynamoPartitionKey(tenantId, idempotencyKey);
            const record = records.get(key);
            const now = getCurrentEpochSeconds();

            if (record !== undefined && record.ttl > now) {
                if (record.requestHash !== requestHash) {
                    throw new IdempotencyRequestMismatchError();
                }

                return record.status === "completed"
                    ? record.result
                    : undefined;
            }

            return undefined;
        },
        async releaseLock(tenantId, idempotencyKey, token) {
            const lockKey = toRedisLockKey(tenantId, idempotencyKey);
            const lock = locks.get(lockKey);

            if (lock?.token === token) {
                locks.delete(lockKey);
            }
        },
        async reserveSubmission(
            tenantId,
            idempotencyKey,
            token,
            requestHash,
            metadata = {},
        ) {
            const key = toDynamoPartitionKey(tenantId, idempotencyKey);
            const now = getCurrentEpochSeconds();
            const existing = records.get(key);

            if (existing !== undefined && existing.ttl > now) {
                return false;
            }

            records.set(key, {
                ...metadata,
                requestHash,
                status: "in_progress",
                submissionToken: token,
                ttl: now + IDEMPOTENCY_RESULT_TTL_SECONDS,
            });
            return true;
        },
        async saveResult(tenantId, idempotencyKey, _token, requestHash, result) {
            const key = toDynamoPartitionKey(tenantId, idempotencyKey);
            const existing = records.get(key);

            if (
                existing === undefined ||
                existing.status !== "in_progress" ||
                existing.requestHash !== requestHash
            ) {
                return;
            }

            records.set(key, {
                ...existing,
                result,
                status: "completed",
            });
        },
    };
}

/**
 * Persists idempotency records in DynamoDB and mirrors completed results in Redis.
 */
export function createIdempotencyStore(
    dynamoDb: DynamoDBDocumentClient,
    redis: RedisClientType,
    tableName: string,
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
        async clearReservation(tenantId, idempotencyKey, token) {
            try {
                await dynamoDb.send(
                    new DeleteCommand({
                        TableName: tableName,
                        Key: {
                            pk: toDynamoPartitionKey(
                                tenantId,
                                idempotencyKey,
                            ),
                        },
                        ConditionExpression:
                            "#status = :inProgress AND submissionToken = :token",
                        ExpressionAttributeNames: {
                            "#status": "status",
                        },
                        ExpressionAttributeValues: {
                            ":inProgress": "in_progress",
                            ":token": token,
                        },
                    }),
                );
            } catch (error: unknown) {
                if (error instanceof ConditionalCheckFailedException) {
                    return;
                }

                throw error;
            }
        },
        async getResult(tenantId, idempotencyKey, requestHash) {
            await connectRedis(redis);
            const redisKey = toRedisResultKey(tenantId, idempotencyKey);
            const cached = await redis.get(redisKey);

            if (cached !== null) {
                const cachedRecord = JSON.parse(cached) as {
                    requestHash: string;
                    result: IdempotencyResult;
                };

                if (cachedRecord.requestHash !== requestHash) {
                    throw new IdempotencyRequestMismatchError();
                }

                return cachedRecord.result;
            }

            const record = await dynamoDb.send(
                new GetCommand({
                    TableName: tableName,
                    Key: {
                        pk: toDynamoPartitionKey(tenantId, idempotencyKey),
                    },
                }),
            );
            const item = record.Item as DynamoIdempotencyRecord | undefined;

            if (
                item !== undefined &&
                item.ttl > getCurrentEpochSeconds() &&
                item.requestHash !== requestHash
            ) {
                throw new IdempotencyRequestMismatchError();
            }

            if (
                item === undefined ||
                item.status !== "completed" ||
                item.result === undefined
            ) {
                return undefined;
            }

            const remainingTtlSeconds =
                item.ttl - getCurrentEpochSeconds();

            if (remainingTtlSeconds <= 0) {
                return undefined;
            }

            await redis.set(
                redisKey,
                JSON.stringify({
                    requestHash: item.requestHash,
                    result: item.result,
                }),
                {
                    EX: remainingTtlSeconds,
                },
            );
            return item.result;
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
        async reserveSubmission(
            tenantId,
            idempotencyKey,
            token,
            requestHash,
            metadata = {},
        ) {
            try {
                const now = getCurrentEpochSeconds();

                await dynamoDb.send(
                    new PutCommand({
                        TableName: tableName,
                        Item: {
                            pk: toDynamoPartitionKey(
                                tenantId,
                                idempotencyKey,
                            ),
                            ...metadata,
                            requestHash,
                            status: "in_progress",
                            submissionToken: token,
                            ttl: now + IDEMPOTENCY_RESULT_TTL_SECONDS,
                        },
                        ConditionExpression:
                            "attribute_not_exists(pk) OR #ttl <= :now",
                        ExpressionAttributeNames: {
                            "#ttl": "ttl",
                        },
                        ExpressionAttributeValues: {
                            ":now": now,
                        },
                    }),
                );
                return true;
            } catch (error: unknown) {
                if (error instanceof ConditionalCheckFailedException) {
                    return false;
                }

                throw error;
            }
        },
        async saveResult(tenantId, idempotencyKey, _token, requestHash, result) {
            const pk = toDynamoPartitionKey(tenantId, idempotencyKey);

            await dynamoDb.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { pk },
                    UpdateExpression:
                        "SET #status = :completed, #result = :result",
                    ConditionExpression:
                        "#status = :inProgress AND requestHash = :requestHash",
                    ExpressionAttributeNames: {
                        "#result": "result",
                        "#status": "status",
                    },
                    ExpressionAttributeValues: {
                        ":completed": "completed",
                        ":inProgress": "in_progress",
                        ":requestHash": requestHash,
                        ":result": result,
                    },
                }),
            );

            const record = await dynamoDb.send(
                new GetCommand({
                    TableName: tableName,
                    Key: { pk },
                }),
            );
            const item = record.Item as DynamoIdempotencyRecord | undefined;
            const remainingTtlSeconds =
                item === undefined ? 0 : item.ttl - getCurrentEpochSeconds();

            if (remainingTtlSeconds <= 0) {
                return;
            }

            await connectRedis(redis);
            await redis.set(
                toRedisResultKey(tenantId, idempotencyKey),
                JSON.stringify({
                    requestHash,
                    result,
                }),
                {
                    EX: remainingTtlSeconds,
                },
            );
        },
    };
}

export function getCurrentEpochSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export function toRedisResultKey(
    tenantId: string,
    idempotencyKey: string,
): string {
    return `idem:${tenantId}:${idempotencyKey}`;
}

export function toRedisLockKey(
    tenantId: string,
    idempotencyKey: string,
): string {
    return `lock:${tenantId}:${idempotencyKey}`;
}

export function toDynamoPartitionKey(
    tenantId: string,
    idempotencyKey: string,
): string {
    return `idem:${tenantId}:${idempotencyKey}`;
}

async function connectRedis(redis: RedisClientType): Promise<void> {
    if (!redis.isOpen) {
        await redis.connect();
    }
}
