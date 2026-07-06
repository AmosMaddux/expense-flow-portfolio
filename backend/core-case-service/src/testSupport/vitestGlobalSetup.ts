import type { TestProject } from "vitest/node";

import {
    startCoreCaseTestDatabase,
    type CoreCaseTestDatabase,
} from "./postgresTestHarness.js";

const coreCaseTestDatabaseUrlKey = "coreCaseTestDatabaseUrl";
let testDatabase: CoreCaseTestDatabase | undefined;

/**
 * Start the shared PostgreSQL container used by Core Case integration tests.
 */
export async function setup(project: TestProject): Promise<void> {
    testDatabase = await startCoreCaseTestDatabase();

    project.provide(coreCaseTestDatabaseUrlKey, testDatabase.connectionString);
}

/**
 * Stop the shared PostgreSQL container after Core Case integration tests finish.
 */
export async function teardown(): Promise<void> {
    await testDatabase?.stop();
    testDatabase = undefined;
}
