import { readdir, readFile } from "node:fs/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const coreCaseServiceDrizzleUrl = new URL("../../drizzle/", import.meta.url);
const migrationFileNamePattern = /^\d{4}_.*\.sql$/u;
const statementBreakpointPattern = /-->\s*statement-breakpoint/u;

export type CoreCaseTestDatabase = {
    connectionString: string;
    container: StartedPostgreSqlContainer;
    stop: () => Promise<void>;
};

/**
 * Start a disposable PostgreSQL database and apply the Core Case schema.
 */
export async function startCoreCaseTestDatabase(): Promise<CoreCaseTestDatabase> {
    const container = await new PostgreSqlContainer("postgres:16-alpine")
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
    const client = new Client({ connectionString });

    await client.connect();

    try {
        await client.query("BEGIN");

        for (const statement of await readMigrationStatements()) {
            await client.query(statement);
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        await client.end();
    }
}

async function readMigrationStatements(): Promise<string[]> {
    const migrationFiles = (await readdir(coreCaseServiceDrizzleUrl))
        .filter((fileName) => migrationFileNamePattern.test(fileName))
        .sort();
    const migrationSql = await Promise.all(
        migrationFiles.map((fileName) =>
            readFile(new URL(fileName, coreCaseServiceDrizzleUrl), "utf8"),
        ),
    );

    return migrationSql.flatMap((sql) =>
        sql
            .split(statementBreakpointPattern)
            .map((statement) => statement.trim())
            .filter((statement) => statement.length > 0),
    );
}
