import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadGlCodingConfig } from "./glCodingConfig.js";

void describe("GL-coding client configuration", () => {
    void test("loads bounded GL-coding settings from the environment", () => {
        const config = loadGlCodingConfig({
            GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
            GL_CODING_TIMEOUT_MS: "3000",
            GL_CODING_MAX_RETRIES: "3",
            GL_CODING_BASE_BACKOFF_MS: "200",
            GL_CODING_MAX_BACKOFF_MS: "2000",
        });

        expect(config).toStrictEqual({
            GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
            GL_CODING_TIMEOUT_MS: 3000,
            GL_CODING_MAX_RETRIES: 3,
            GL_CODING_BASE_BACKOFF_MS: 200,
            GL_CODING_MAX_BACKOFF_MS: 2000,
        });
    });

    void test("requires an explicit GL-coding service URL", () => {
        expect(() => loadGlCodingConfig({})).toThrow(ConfigurationError);
        expect(() => loadGlCodingConfig({})).toThrow(
            "GL_CODING_SERVICE_BASE_URL",
        );
    });

    void test("rejects excessive retry and backoff settings", () => {
        expect(() =>
            loadGlCodingConfig({
                GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
                GL_CODING_MAX_RETRIES: "6",
            }),
        ).toThrow(ConfigurationError);
        expect(() =>
            loadGlCodingConfig({
                GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
                GL_CODING_MAX_RETRIES: "6",
            }),
        ).toThrow("GL_CODING_MAX_RETRIES");
        expect(() =>
            loadGlCodingConfig({
                GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
                GL_CODING_TIMEOUT_MS: "30001",
            }),
        ).toThrow("GL_CODING_TIMEOUT_MS");
        expect(() =>
            loadGlCodingConfig({
                GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
                GL_CODING_BASE_BACKOFF_MS: "5001",
            }),
        ).toThrow("GL_CODING_BASE_BACKOFF_MS");
        expect(() =>
            loadGlCodingConfig({
                GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
                GL_CODING_MAX_BACKOFF_MS: "30001",
            }),
        ).toThrow("GL_CODING_MAX_BACKOFF_MS");
    });
});
