import { inject } from "vitest";

/**
 * Return the shared Core Case integration test database connection string.
 */
export function getCoreCaseTestDatabaseUrl(): string {
    return inject("coreCaseTestDatabaseUrl");
}
