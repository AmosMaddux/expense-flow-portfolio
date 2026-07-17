import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | undefined;

/**
 * Returns a connected Redis client when Redis is configured for the service.
 */
export async function getRedisClient(): Promise<RedisClientType | undefined> {
    if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
        return undefined;
    }

    redisClient ??= createClient({
        url: process.env.REDIS_URL,
    });

    if (!redisClient.isOpen) {
        await redisClient.connect();
    }

    return redisClient;
}
