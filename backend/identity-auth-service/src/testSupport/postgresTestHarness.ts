import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const identityAuthServiceDrizzleUrl = new URL(
    "../../drizzle/",
    import.meta.url,
);
const identityAuthServiceDrizzlePath = fileURLToPath(
    identityAuthServiceDrizzleUrl,
);

export type IdentityAuthTestDatabase = {
    connectionString: string;
    container: StartedPostgreSqlContainer;
    stop: () => Promise<void>;
};

/**
 * Start a disposable PostgreSQL database and apply the Identity & Auth schema.
 */
export async function startIdentityAuthTestDatabase(): Promise<IdentityAuthTestDatabase> {
    const container = await new PostgreSqlContainer("postgres:17-alpine")
        .withDatabase("expenseflow_identity_auth")
        .withUsername("expenseflow")
        .withPassword("expenseflow")
        .start();

    const connectionString = container.getConnectionUri();

    try {
        await applyIdentityAuthSchema(connectionString);
    } catch (error) {
        await container.stop();
        throw error;
    }

    return {
        connectionString,
        container,
        stop: async () => {
            await container.stop();
        },
    };
}

/**
 * Apply every checked-in Drizzle migration to a PostgreSQL database.
 */
export async function applyIdentityAuthSchema(
    connectionString: string,
): Promise<void> {
    const pool = new Pool({ connectionString });
    const db = drizzle(pool);

    try {
        await migrate(db, {
            migrationsFolder: identityAuthServiceDrizzlePath,
        });
    } finally {
        await pool.end();
    }
}
