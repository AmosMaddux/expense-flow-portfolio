import { describe, expect, test } from "vitest";

import { loadRateLimitConfig } from "./rateLimitConfig.js";

void describe("rate limit configuration", () => {
    void test("uses safe defaults when environment overrides are absent", () => {
        expect(loadRateLimitConfig({})).toStrictEqual({
            requests: 100,
            windowSeconds: 60,
        });
    });

    void test("reads per-environment request and window limits", () => {
        expect(
            loadRateLimitConfig({
                CORE_CASE_RATE_LIMIT_REQUESTS: "25",
                CORE_CASE_RATE_LIMIT_WINDOW_SECONDS: "30",
            }),
        ).toStrictEqual({ requests: 25, windowSeconds: 30 });
    });

    void test("rejects non-positive limits", () => {
        expect(() =>
            loadRateLimitConfig({
                CORE_CASE_RATE_LIMIT_REQUESTS: "0",
            }),
        ).toThrow();
    });
});
