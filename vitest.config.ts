import { configDefaults, defineConfig } from "vitest/config";

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
const identityAuthVitestGlobalSetup = new URL(
    "./backend/identity-auth-service/src/testSupport/vitestGlobalSetup.ts",
    import.meta.url,
).pathname;
const identityAuthSourceRoot = new URL(
    "./backend/identity-auth-service/src/",
    import.meta.url,
).pathname;
const identityAuthIntegrationTestGlob = `${identityAuthSourceRoot}**/*.integration.test.ts`;
const identityAuthUnitTestGlob = `${identityAuthSourceRoot}**/*.test.ts`;

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, "**/dist"],
        projects: [
            {
                test: {
                    name: "unit",
                    exclude: [
                        ...configDefaults.exclude,
                        "**/dist",
                        coreCaseIntegrationTestGlob,
                        identityAuthIntegrationTestGlob,
                    ],
                    include: [coreCaseUnitTestGlob, identityAuthUnitTestGlob],
                    root: repositoryRoot,
                },
            },
            {
                test: {
                    name: "integration",
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
                    name: "identity-auth-integration",
                    exclude: [...configDefaults.exclude, "**/dist"],
                    fileParallelism: false,
                    globalSetup: [identityAuthVitestGlobalSetup],
                    hookTimeout: 60_000,
                    include: [identityAuthIntegrationTestGlob],
                    maxWorkers: 1,
                    pool: "forks",
                    root: repositoryRoot,
                    testTimeout: 60_000,
                },
            },
        ],
    },
});
