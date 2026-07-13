import { inject } from "vitest";

/**
 * Return the shared Identity & Auth integration test database connection string.
 */
export function getIdentityAuthTestDatabaseUrl(): string {
    return inject("identityAuthTestDatabaseUrl");
}
