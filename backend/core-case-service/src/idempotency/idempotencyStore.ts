import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
    DeleteCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
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

type StoredIdempotencyRecord = {
    pk: string;
    requestHash: string;
    result?: IdempotencyResult;
    status: "completed" | "in_progress";
    submissionToken?: string;
} & IdempotencyReservationMetadata;

type CachedIdempotencyRecord = {
    requestHash: string;
    result: IdempotencyResult;
};

/**
 * Persists idempotency results in DynamoDB and mirrors completed results in Redis.
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
                            pk: toDynamoPartitionKey(tenantId, idempotencyKey),
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
                const cachedRecord = JSON.parse(
                    cached,
                ) as CachedIdempotencyRecord;
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
            const item = record.Item as StoredIdempotencyRecord | undefined;
            if (item !== undefined && item.requestHash !== requestHash) {
                throw new IdempotencyRequestMismatchError();
            }

            if (
                item === undefined ||
                item.status !== "completed" ||
                item.result === undefined
            ) {
                return undefined;
            }

            await redis.set(
                redisKey,
                JSON.stringify({
                    requestHash: item.requestHash,
                    result: item.result,
                } satisfies CachedIdempotencyRecord),
                {
                    EX: IDEMPOTENCY_RESULT_TTL_SECONDS,
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
                await dynamoDb.send(
                    new PutCommand({
                        TableName: tableName,
                        Item: {
                            pk: toDynamoPartitionKey(tenantId, idempotencyKey),
                            ...metadata,
                            requestHash,
                            status: "in_progress",
                            submissionToken: token,
                        } satisfies StoredIdempotencyRecord,
                        ConditionExpression: "attribute_not_exists(pk)",
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
        async saveResult(tenantId, idempotencyKey, token, requestHash, result) {
            const pk = toDynamoPartitionKey(tenantId, idempotencyKey);

            await dynamoDb.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { pk },
                    UpdateExpression:
                        "SET #status = :completed, #result = :result",
                    ConditionExpression:
                        "#status = :inProgress AND submissionToken = :token AND requestHash = :requestHash",
                    ExpressionAttributeNames: {
                        "#result": "result",
                        "#status": "status",
                    },
                    ExpressionAttributeValues: {
                        ":completed": "completed",
                        ":inProgress": "in_progress",
                        ":requestHash": requestHash,
                        ":result": result,
                        ":token": token,
                    },
                }),
            );

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
