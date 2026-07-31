import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

import {
    authenticationAuditEntry,
    credential,
    refreshToken,
    role,
    user,
} from "./identityAuth.js";

const requiredTables = [
    getTableConfig(user),
    getTableConfig(credential),
    getTableConfig(role),
    getTableConfig(refreshToken),
    getTableConfig(authenticationAuditEntry),
];

const tenantAId = "00000000-0000-0000-0000-000000000221";
const tenantBId = "00000000-0000-0000-0000-000000000222";
const userAId = "10000000-0000-0000-0000-000000000221";

void describe("identity auth PostgreSQL schema", () => {
    let client: Client;

    beforeAll(async () => {
        client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
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

    test.each([
        {
            childTableName: "credential",
            insertSql: `
INSERT INTO "credential" ("tenant_id", "user_id", "password_hash", "password_hash_algorithm")
VALUES ($1, $2, $3, $4);
`,
            params: [tenantBId, userAId, "synthetic-password-hash", "argon2id"],
            constraint: "credential_user_tenant_fk",
        },
        {
            childTableName: "role",
            insertSql: `
INSERT INTO "role" ("tenant_id", "user_id", "name")
VALUES ($1, $2, $3);
`,
            params: [tenantBId, userAId, "Admin"],
            constraint: "role_user_tenant_fk",
        },
        {
            childTableName: "refresh_token",
            insertSql: `
INSERT INTO "refresh_token" ("tenant_id", "user_id", "token_hash", "expires_at")
VALUES ($1, $2, $3, $4);
`,
            params: [
                tenantBId,
                userAId,
                "synthetic-refresh-token-hash",
                "2026-07-09T00:00:00.000Z",
            ],
            constraint: "refresh_token_user_tenant_fk",
        },
    ])(
        "rejects $childTableName rows whose tenant_id does not match the parent user",
        async ({ insertSql, params, constraint }) => {
            await client.query("BEGIN");

            try {
                await client.query(
                    `
INSERT INTO "user" ("id", "tenant_id", "email")
VALUES ($1, $2, $3);
`,
                    [userAId, tenantAId, "tenant-a-user@example.invalid"],
                );

                await expect(
                    client.query(insertSql, params),
                ).rejects.toMatchObject({
                    code: "23503",
                    constraint,
                });
            } finally {
                await client.query("ROLLBACK");
            }
        },
    );

    void test("rejects same-tenant email duplicates that differ only by case", async () => {
        await client.query("BEGIN");

        try {
            await client.query(
                `
INSERT INTO "user" ("tenant_id", "email")
VALUES ($1, $2);
`,
                [tenantAId, "case-test@example.invalid"],
            );

            await expect(
                client.query(
                    `
INSERT INTO "user" ("tenant_id", "email")
VALUES ($1, $2);
`,
                    [tenantAId, "CASE-TEST@example.invalid"],
                ),
            ).rejects.toMatchObject({
                code: "23505",
                constraint: "user_tenant_email_unique_idx",
            });
        } finally {
            await client.query("ROLLBACK");
        }
    });

    void test("rejects duplicate refresh token hashes", async () => {
        await client.query("BEGIN");

        try {
            await client.query(
                `
INSERT INTO "user" ("id", "tenant_id", "email")
VALUES ($1, $2, $3);
`,
                [userAId, tenantAId, "refresh-token-user@example.invalid"],
            );

            await client.query(
                `
INSERT INTO "refresh_token" ("tenant_id", "user_id", "token_hash", "expires_at")
VALUES ($1, $2, $3, $4);
`,
                [
                    tenantAId,
                    userAId,
                    "duplicate-refresh-token-hash",
                    "2026-07-09T00:00:00.000Z",
                ],
            );

            await expect(
                client.query(
                    `
INSERT INTO "refresh_token" ("tenant_id", "user_id", "token_hash", "expires_at")
VALUES ($1, $2, $3, $4);
`,
                    [
                        tenantAId,
                        userAId,
                        "duplicate-refresh-token-hash",
                        "2026-07-10T00:00:00.000Z",
                    ],
                ),
            ).rejects.toMatchObject({
                code: "23505",
                constraint: "refresh_token_token_hash_unique_idx",
            });
        } finally {
            await client.query("ROLLBACK");
        }
    });

    void test("rejects unsupported audit entry actions", async () => {
        await client.query("BEGIN");

        try {
            await expect(
                client.query(
                    `
INSERT INTO "authentication_audit_entry" ("tenant_id", "action", "email")
VALUES ($1, $2, $3);
`,
                    [
                        tenantAId,
                        "synthetic_unsupported_action",
                        "audit-entry-action@example.invalid",
                    ],
                ),
            ).rejects.toMatchObject({
                code: "23514",
                constraint: "authentication_audit_entry_action_check",
            });
        } finally {
            await client.query("ROLLBACK");
        }
    });
});
