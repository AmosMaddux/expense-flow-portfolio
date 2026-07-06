import { configDefaults, defineConfig } from "vitest/config";

const coreCaseVitestGlobalSetup = new URL(
    "./backend/core-case-service/src/testSupport/vitestGlobalSetup.ts",
    import.meta.url,
).pathname;

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, "**/dist"],
        fileParallelism: false,
        globalSetup: [coreCaseVitestGlobalSetup],
        hookTimeout: 60_000,
        maxWorkers: 1,
        pool: "forks",
        testTimeout: 60_000,
    },
});
