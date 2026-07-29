import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import { sql, type SQLWrapper } from "drizzle-orm";

type MigrationStatementExecutor = {
    execute(query: SQLWrapper | string): PromiseLike<unknown>;
};

type MigrationDatabase = MigrationStatementExecutor & {
    transaction<T>(
        callback: (tx: MigrationStatementExecutor) => Promise<T>,
    ): Promise<T>;
};

type AppliedMigrationRow = {
    created_at?: unknown;
};

/**
 * Applies Drizzle migrations while allowing concurrent-index migrations to run outside transactions.
 */
export async function applyDrizzleMigrations(
    db: MigrationDatabase,
    config: MigrationConfig,
): Promise<void> {
    const migrations = readMigrationFiles(config);
    const migrationsSchema = config.migrationsSchema ?? "drizzle";
    const migrationsTable = config.migrationsTable ?? "__drizzle_migrations";

    await db.execute(
        sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(migrationsSchema)}`,
    );
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `);

    const latestMigrationResult = (await db.execute(sql`
        select id, hash, created_at
        from ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}
        order by created_at desc
        limit 1
    `)) as { rows?: AppliedMigrationRow[] };
    const latestMigration = latestMigrationResult.rows?.[0];
    const latestMigrationMillis =
        latestMigration?.created_at === undefined
            ? undefined
            : Number(latestMigration.created_at);

    for (const migration of migrations) {
        if (
            latestMigrationMillis !== undefined &&
            latestMigrationMillis >= migration.folderMillis
        ) {
            continue;
        }

        if (isConcurrentIndexMigration(migration.sql)) {
            await applyMigrationStatements(db, migration.sql);
            await recordAppliedMigration(db, {
                hash: migration.hash,
                migrationsSchema,
                migrationsTable,
                timestampMillis: migration.folderMillis,
            });
            continue;
        }

        await db.transaction(async (tx) => {
            await applyMigrationStatements(tx, migration.sql);
            await recordAppliedMigration(tx, {
                hash: migration.hash,
                migrationsSchema,
                migrationsTable,
                timestampMillis: migration.folderMillis,
            });
        });
    }
}

async function applyMigrationStatements(
    executor: MigrationStatementExecutor,
    statements: readonly string[],
): Promise<void> {
    for (const statement of statements) {
        if (statement.trim().length === 0) {
            continue;
        }

        await executor.execute(sql.raw(statement));
    }
}

async function recordAppliedMigration(
    executor: MigrationStatementExecutor,
    {
        hash,
        migrationsSchema,
        migrationsTable,
        timestampMillis,
    }: {
        hash: string;
        migrationsSchema: string;
        migrationsTable: string;
        timestampMillis: number;
    },
): Promise<void> {
    await executor.execute(sql`
        insert into ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}
            ("hash", "created_at")
        values (${hash}, ${timestampMillis})
    `);
}

function isConcurrentIndexMigration(statements: readonly string[]): boolean {
    return statements.some((statement) =>
        statement.toLowerCase().includes("create index concurrently"),
    );
}
