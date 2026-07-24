import { randomBytes } from "node:crypto";

import { configDefaults, defineConfig } from "vitest/config";

import { syntheticRsaPrivateKeyBase64 } from "./backend/core-case-service/src/testSupport/jwtTestKeys.js";

const repositoryRoot = new URL(".", import.meta.url).pathname;
const coreCaseVitestGlobalSetup = new URL(
    "./backend/core-case-service/src/testSupport/vitestGlobalSetup.ts",
    import.meta.url,
).pathname;
const coreCaseSourceRoot = new URL(
    "./backend/core-case-service/src/",
    import.meta.url,
).pathname;
const coreCaseIntegrationTestGlob = `${coreCaseSourceRoot}**/*.integration.test.ts`;
const coreCaseUnitTestGlob = `${coreCaseSourceRoot}**/*.test.ts`;
const frontendSourceRoot = new URL("./frontend/app/src/", import.meta.url)
    .pathname;
const testEnvironment = {
    AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
    AUTH_JWT_KEY_ID: "synthetic-vitest-key",
    GL_CODING_SERVICE_BASE_URL: "http://gl-coding.example.test",
    MFA_TOTP_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MFA_TOTP_SECRET_KEY_VERSION: "synthetic-vitest-key",
    CORE_CASE_RATE_LIMIT_REQUESTS: "2",
    CORE_CASE_RATE_LIMIT_WINDOW_SECONDS: "60",
};

export default defineConfig({
    test: {
        coverage: {
            provider: "v8",
            reportsDirectory: "coverage/typescript",
            reporter: ["text", "json-summary", "html"],
            include: ["backend/core-case-service/src/**/*.ts"],
            exclude: [
                "backend/core-case-service/src/**/*.test.ts",
                "backend/core-case-service/src/**/*.d.ts",
                "backend/core-case-service/src/dev/**",
                "backend/core-case-service/src/testSupport/**",
            ],
            thresholds: {
                branches: 80,
                functions: 80,
                lines: 80,
                statements: 80,
            },
        },
        env: testEnvironment,
        exclude: [...configDefaults.exclude, "**/dist"],
        projects: [
            {
                test: {
                    name: "unit",
                    env: testEnvironment,
                    exclude: [
                        ...configDefaults.exclude,
                        "**/dist",
                        coreCaseIntegrationTestGlob,
                    ],
                    hookTimeout: 60_000,
                    include: [coreCaseUnitTestGlob],
                    root: repositoryRoot,
                },
            },
            {
                test: {
                    name: "integration",
                    env: testEnvironment,
                    exclude: [...configDefaults.exclude, "**/dist"],
                    fileParallelism: false,
                    globalSetup: [coreCaseVitestGlobalSetup],
                    hookTimeout: 60_000,
                    include: [coreCaseIntegrationTestGlob],
                    maxWorkers: 1,
                    pool: "forks",
                    root: repositoryRoot,
                    testTimeout: 60_000,
                },
            },
            {
                test: {
                    name: "frontend",
                    environment: "jsdom",
                    include: [`${frontendSourceRoot}**/*.test.{ts,tsx}`],
                    root: repositoryRoot,
                    testTimeout: 10_000,
                },
            },
        ],
    },
});
