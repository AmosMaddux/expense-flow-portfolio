import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { applyDrizzleMigrations } from "../db/drizzleMigrationRunner.js";

/**
 * PostgreSQL image used by Core Case integration tests. The pgvector build is
 * required because the checked-in migrations create the `vector` extension for
 * policy chunk embeddings.
 */
export const coreCaseTestPostgresImage = "pgvector/pgvector:pg17";

const coreCaseServiceDrizzleUrl = new URL("../../drizzle/", import.meta.url);
const coreCaseServiceDrizzlePath = fileURLToPath(coreCaseServiceDrizzleUrl);

export type CoreCaseTestDatabase = {
    connectionString: string;
    container: StartedPostgreSqlContainer;
    stop: () => Promise<void>;
};

/**
 * Start a disposable PostgreSQL database and apply the Core Case schema.
 */
export async function startCoreCaseTestDatabase(): Promise<CoreCaseTestDatabase> {
    const container = await new PostgreSqlContainer(coreCaseTestPostgresImage)
        .withDatabase("expenseflow_core_case")
        .withUsername("expenseflow")
        .withPassword("expenseflow")
        .start();

    const connectionString = container.getConnectionUri();

    try {
        await applyCoreCaseSchema(connectionString);
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
export async function applyCoreCaseSchema(
    connectionString: string,
): Promise<void> {
    const pool = new Pool({ connectionString });
    const db = drizzle(pool);

    try {
        await applyDrizzleMigrations(db, {
            migrationsFolder: coreCaseServiceDrizzlePath,
        });
    } finally {
        await pool.end();
    }
}
