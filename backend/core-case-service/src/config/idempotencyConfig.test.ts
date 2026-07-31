import { describe, expect, test } from "vitest";

import { loadIdempotencyConfig } from "./idempotencyConfig.js";

void describe("idempotency configuration", () => {
    void test("uses local defaults when infrastructure settings are absent", () => {
        expect(loadIdempotencyConfig({})).toEqual({
            redisUrl: "redis://127.0.0.1:6379",
            storeBackend: "redis",
        });
    });

    void test("loads explicit infrastructure settings", () => {
        expect(
            loadIdempotencyConfig({
                IDEMPOTENCY_STORE_BACKEND: "memory",
                REDIS_URL: "redis://redis.example.test:6379",
            }),
        ).toEqual({
            redisUrl: "redis://redis.example.test:6379",
            storeBackend: "memory",
        });
    });
});
