import {
    GetCommand,
    PutCommand,
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

export type IdempotencyStore = {
    acquireLock: (
        tenantId: string,
        idempotencyKey: string,
    ) => Promise<string | undefined>;
    getResult: (
        tenantId: string,
        idempotencyKey: string,
    ) => Promise<IdempotencyResult | undefined>;
    releaseLock: (
        tenantId: string,
        idempotencyKey: string,
        token: string,
    ) => Promise<void>;
    saveResult: (
        tenantId: string,
        idempotencyKey: string,
        result: IdempotencyResult,
    ) => Promise<void>;
};

type StoredIdempotencyRecord = {
    pk: string;
    result: IdempotencyResult;
    ttl: number;
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
        async getResult(tenantId, idempotencyKey) {
            await connectRedis(redis);

            const redisKey = toRedisResultKey(tenantId, idempotencyKey);
            const cached = await redis.get(redisKey);
            if (cached !== null) {
                return JSON.parse(cached) as IdempotencyResult;
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
            if (item === undefined) {
                return undefined;
            }

            await redis.set(redisKey, JSON.stringify(item.result), {
                EX: IDEMPOTENCY_RESULT_TTL_SECONDS,
            });

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
        async saveResult(tenantId, idempotencyKey, result) {
            const ttl =
                Math.floor(Date.now() / 1000) + IDEMPOTENCY_RESULT_TTL_SECONDS;
            const pk = toDynamoPartitionKey(tenantId, idempotencyKey);

            await dynamoDb.send(
                new PutCommand({
                    TableName: tableName,
                    Item: {
                        pk,
                        result,
                        ttl,
                    } satisfies StoredIdempotencyRecord,
                    ConditionExpression: "attribute_not_exists(pk)",
                }),
            );

            await connectRedis(redis);
            await redis.set(
                toRedisResultKey(tenantId, idempotencyKey),
                JSON.stringify(result),
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
