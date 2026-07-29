import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { applyDrizzleMigrations } from "./drizzleMigrationRunner.js";

const coreCaseServiceDrizzleUrl = new URL("../../drizzle/", import.meta.url);
const coreCaseServiceDrizzlePath = fileURLToPath(coreCaseServiceDrizzleUrl);

/**
 * Apply checked-in Core Case database migrations to the configured database.
 */
export async function applyPendingCoreCaseMigrations(
    connectionString = process.env.DATABASE_URL,
): Promise<void> {
    if (connectionString === undefined || connectionString.length === 0) {
        throw new Error(
            "DATABASE_URL is required to apply database migrations.",
        );
    }

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
