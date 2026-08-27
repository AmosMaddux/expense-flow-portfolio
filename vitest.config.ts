import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

function toConfigPath(url: URL): string {
    return fileURLToPath(url).replace(/\\/g, "/");
}

const repositoryRoot = toConfigPath(new URL(".", import.meta.url));
const coreCaseVitestGlobalSetup = toConfigPath(
    new URL(
        "./backend/core-case-service/src/testSupport/vitestGlobalSetup.ts",
        import.meta.url,
    ),
);
const coreCaseSourceRoot = toConfigPath(
    new URL("./backend/core-case-service/src/", import.meta.url),
);
const coreCaseTestsRoot = toConfigPath(
    new URL("./backend/core-case-service/tests/", import.meta.url),
);
const coreCaseIntegrationTestGlob = `${coreCaseSourceRoot}**/*.integration.test.ts`;
const coreCaseUnitTestGlob = `${coreCaseSourceRoot}**/*.test.ts`;
const coreCaseProductionTestGlob = `${coreCaseTestsRoot}production/**/*.test.ts`;
const frontendSourceRoot = toConfigPath(
    new URL("./frontend/app/src/", import.meta.url),
);
const platformHttpApiSourceRoot = toConfigPath(
    new URL("./platform/http-api/src/", import.meta.url),
);
const syntheticRsaKeyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
});
const syntheticRsaPrivateKeyBase64 = Buffer.from(
    syntheticRsaKeyPair.privateKey.export({
        type: "pkcs8",
        format: "pem",
    }),
).toString("base64");
const testEnvironment = {
    AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
    AUTH_JWT_KEY_ID: "synthetic-vitest-key",
    DATABASE_URL:
        "postgres://synthetic:synthetic@127.0.0.1:55432/expenseflow_core_case_test",
    GL_CODING_SERVICE_BASE_URL: "http://gl-coding.example.test",
    MFA_TOTP_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MFA_TOTP_SECRET_KEY_VERSION: "synthetic-vitest-key",
    CORE_CASE_INTERNAL_COMMAND_TOKEN:
        "synthetic-core-case-internal-command-token",
    CORE_CASE_RATE_LIMIT_REQUESTS: "2",
    CORE_CASE_RATE_LIMIT_WINDOW_SECONDS: "60",
};
const shouldRunCoreCaseIntegrationTests =
    process.env.EXPENSE_FLOW_RUN_INTEGRATION_TESTS === "1" ||
    process.env.CI === "true" ||
    process.env.DOCKER_HOST !== undefined ||
    existsSync("/var/run/docker.sock") ||
    existsSync(`${process.env.XDG_RUNTIME_DIR ?? ""}/docker.sock`);
const coreCaseUnitProject = {
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
};
const coreCaseIntegrationProject = {
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
};
const coreCaseProductionProject = {
    test: {
        name: "production",
        env: testEnvironment,
        exclude: [...configDefaults.exclude, "**/dist"],
        fileParallelism: false,
        include: [coreCaseProductionTestGlob],
        maxWorkers: 1,
        pool: "forks",
        root: repositoryRoot,
        testTimeout: 180_000,
    },
};
const frontendProject = {
    test: {
        name: "frontend",
        environment: "jsdom",
        include: [`${frontendSourceRoot}**/*.test.{ts,tsx}`],
        root: repositoryRoot,
        testTimeout: 10_000,
    },
};
const platformHttpApiProject = {
    test: {
        name: "platform-http-api",
        include: [`${platformHttpApiSourceRoot}**/*.test.ts`],
        root: repositoryRoot,
    },
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
            ...(shouldRunCoreCaseIntegrationTests
                ? {
                      thresholds: {
                          branches: 80,
                          functions: 80,
                          lines: 80,
                          statements: 80,
                      },
                  }
                : {}),
        },
        env: testEnvironment,
        exclude: [...configDefaults.exclude, "**/dist"],
        projects: [
            coreCaseUnitProject,
            ...(shouldRunCoreCaseIntegrationTests
                ? [coreCaseIntegrationProject]
                : []),
            coreCaseProductionProject,
            frontendProject,
            platformHttpApiProject,
        ],
    },
});
