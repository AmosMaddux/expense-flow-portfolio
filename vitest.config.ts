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
                    ],
                    include: [coreCaseUnitTestGlob],
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
        ],
    },
});
