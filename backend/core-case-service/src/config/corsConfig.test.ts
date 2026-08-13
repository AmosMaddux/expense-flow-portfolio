import { describe, expect, test } from "vitest";

import { loadCorsConfig } from "./corsConfig.js";

void describe("CORS configuration", () => {
    void test("requires one HTTPS origin in production", () => {
        expect(
            loadCorsConfig({
                NODE_ENV: "production",
                SPA_ORIGIN: "https://spa.example.test",
            }),
        ).toStrictEqual({
            allowedOrigin: "https://spa.example.test",
        });
    });

    void test.each([
        undefined,
        "http://spa.example.test",
        "https://spa.example.test/application",
    ])("rejects an unsafe production origin: %s", (spaOrigin) => {
        expect(() =>
            loadCorsConfig({
                NODE_ENV: "production",
                ...(spaOrigin === undefined ? {} : { SPA_ORIGIN: spaOrigin }),
            }),
        ).toThrow();
    });

    void test("allows CORS to remain disabled for same-origin local tests", () => {
        expect(loadCorsConfig({ NODE_ENV: "test" })).toStrictEqual({
            allowedOrigin: undefined,
        });
    });
});
