import type { TestProject } from "vitest/node";

import { startCoreCaseTestDatabase } from "./postgresTestHarness.js";

const coreCaseTestDatabaseUrlKey = "coreCaseTestDatabaseUrl";

/**
 * Start the shared PostgreSQL container used by Core Case integration tests.
 */
export default async function setup(
    project: TestProject,
): Promise<() => Promise<void>> {
    const testDatabase = await startCoreCaseTestDatabase();

    project.provide(coreCaseTestDatabaseUrlKey, testDatabase.connectionString);

    return async () => {
        await testDatabase.stop();
    };
}
