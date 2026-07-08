import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { getIdentityAuthTestDatabaseUrl } from "../../testSupport/identityAuthTestDatabase.js";

import { credential, refreshToken, role, user } from "./identityAuth.js";

const requiredTables = [
    getTableConfig(user),
    getTableConfig(credential),
    getTableConfig(role),
    getTableConfig(refreshToken),
];

void describe("identity auth PostgreSQL schema", () => {
    let client: Client;

    beforeAll(async () => {
        client = new Client({
            connectionString: getIdentityAuthTestDatabaseUrl(),
        });

        await client.connect();
    });

    afterAll(async () => {
        await client.end().catch(() => undefined);
    });

    test.each(requiredTables)(
        "creates table, constraints, and indexes",
        async (table) => {
            const tableExistsResult = await client.query(
                "SELECT COUNT(*) as count FROM pg_catalog.pg_tables WHERE tablename = $1",
                [table.name],
            );

            expect(tableExistsResult.rowCount).toEqual(1);
            expect(tableExistsResult.rows[0]).toMatchObject({
                count: "1",
            });

            const constraints = [
                ...table.checks.map((checkConstraint) => checkConstraint.name),
                ...table.foreignKeys.map((foreignKeyConfig) =>
                    foreignKeyConfig.getName(),
                ),
            ];
            const constraintsExistResult = await client.query(
                `SELECT COUNT(*) as count
            FROM pg_catalog.pg_constraint con
                    INNER JOIN pg_catalog.pg_class rel
                            ON rel.oid = con.conrelid
                    INNER JOIN pg_catalog.pg_namespace nsp
                            ON nsp.oid = connamespace
            WHERE nsp.nspname = $1
                    AND rel.relname = $2
                    AND con.conname = ANY($3);`,
                ["public", table.name, constraints],
            );

            expect(constraintsExistResult.rowCount).toEqual(1);
            expect(constraintsExistResult.rows[0]).toMatchObject({
                count: constraints.length.toString(),
            });

            const indexes = table.indexes
                .map((indexConfig) => indexConfig.config.name)
                .filter((indexName) => indexName !== undefined);
            const indexesExistResult = await client.query(
                "SELECT COUNT(*) as count FROM pg_indexes WHERE tablename = $1 AND indexname = ANY($2)",
                [table.name, indexes],
            );

            expect(indexesExistResult.rowCount).toEqual(1);
            expect(indexesExistResult.rows[0]).toMatchObject({
                count: indexes.length.toString(),
            });
        },
    );

    void test("rejects role names outside the repository vocabulary", async () => {
        const tenantId = "00000000-0000-0000-0000-000000000121";
        const userId = "10000000-0000-0000-0000-000000000121";

        await client.query("BEGIN");

        try {
            await client.query(
                `
INSERT INTO "user" ("id", "tenant_id", "email")
VALUES ($1, $2, $3);
`,
                [userId, tenantId, "identity-auth-test@example.invalid"],
            );

            await client.query(
                `
INSERT INTO "role" ("tenant_id", "user_id", "name")
VALUES ($1, $2, $3);
`,
                [tenantId, userId, "Admin"],
            );

            await expect(
                client.query(
                    `
INSERT INTO "role" ("tenant_id", "user_id", "name")
VALUES ($1, $2, $3);
`,
                    [tenantId, userId, "ExpenseFlow Platform Admin"],
                ),
            ).rejects.toMatchObject({
                code: "23514",
                constraint: "role_name_check",
            });
        } finally {
            await client.query("ROLLBACK");
        }
    });
});
