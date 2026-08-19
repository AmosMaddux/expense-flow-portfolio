import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadDatabaseConfig } from "../config/databaseConfig.js";

import { applyDrizzleMigrations } from "./drizzleMigrationRunner.js";

const coreCaseServiceDrizzleUrl = new URL("../../drizzle/", import.meta.url);
const coreCaseServiceDrizzlePath = fileURLToPath(coreCaseServiceDrizzleUrl);

/**
 * Apply checked-in Core Case database migrations to the configured database.
 */
export async function applyPendingCoreCaseMigrations(
    connectionString = loadDatabaseConfig().connectionString,
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
