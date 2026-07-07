import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

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
        await migrate(db, {
            migrationsFolder: coreCaseServiceDrizzlePath,
        });
    } finally {
        await pool.end();
    }
}
