import type { TestProject } from "vitest/node";

import {
    startIdentityAuthTestDatabase,
    type IdentityAuthTestDatabase,
} from "./postgresTestHarness.js";

const identityAuthTestDatabaseUrlKey = "identityAuthTestDatabaseUrl";
let testDatabase: IdentityAuthTestDatabase | undefined;

/**
 * Start the shared PostgreSQL container used by Identity & Auth integration tests.
 */
export async function setup(project: TestProject): Promise<void> {
    testDatabase = await startIdentityAuthTestDatabase();

    project.provide(
        identityAuthTestDatabaseUrlKey,
        testDatabase.connectionString,
    );
}

/**
 * Stop the shared PostgreSQL container after Identity & Auth integration tests finish.
 */
export async function teardown(): Promise<void> {
    await testDatabase?.stop();
    testDatabase = undefined;
}
