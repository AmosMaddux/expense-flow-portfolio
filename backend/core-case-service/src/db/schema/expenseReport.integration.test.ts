import { readFile, readdir } from "node:fs/promises";

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { getTableConfig } from "drizzle-orm/pg-core";

import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

import {
    expenseReport,
    auditEntry,
    stageTransition,
    stageTransitionOutbox,
    stageTransitionProjection,
    lineItem,
    glCode,
    glMapping,
    caseComment,
    attachmentMetadata,
    receiptMetadata,
    mileageEntry,
} from "./expenseReport.js";

const requiredTables = [
    getTableConfig(expenseReport),
    getTableConfig(auditEntry),
    getTableConfig(stageTransition),
    getTableConfig(stageTransitionOutbox),
    getTableConfig(stageTransitionProjection),
    getTableConfig(lineItem),
    getTableConfig(glCode),
    getTableConfig(glMapping),
    getTableConfig(caseComment),
    getTableConfig(attachmentMetadata),
    getTableConfig(receiptMetadata),
    getTableConfig(mileageEntry),
];

const migrationsUrl = new URL("../../../drizzle/", import.meta.url);

async function applyMigrationRange(
    client: Client,
    minimumMigrationNumber: number,
    maximumMigrationNumber: number,
): Promise<void> {
    const migrationFileNames = (await readdir(migrationsUrl))
        .filter((fileName) => /^\d{4}_.*\.sql$/u.test(fileName))
        .filter((fileName) => {
            const migrationNumber = Number(fileName.slice(0, 4));

            return (
                migrationNumber >= minimumMigrationNumber &&
                migrationNumber <= maximumMigrationNumber
            );
        })
        .sort();

    for (const fileName of migrationFileNames) {
        const migrationSql = await readFile(
            new URL(fileName, migrationsUrl),
            "utf8",
        );
        const statements = migrationSql
            .split(/-->\s*statement-breakpoint/u)
            .map((statement) => statement.trim())
            .filter((statement) => statement.length > 0);

        for (const statement of statements) {
            await client.query(statement);
        }
    }
}
void describe("audit entry sequence migration", () => {
    void test("backfills populated audit entries while preserving append-only enforcement", async () => {
        const container = await new PostgreSqlContainer("postgres:17-alpine")
            .withDatabase("expenseflow_core_case_sequence")
            .withUsername("expenseflow")
            .withPassword("expenseflow")
            .start();
        const client = new Client({
            connectionString: container.getConnectionUri(),
        });
        const tenantId = "00000000-0000-4000-8000-000000000501";
        const reportId = "10000000-0000-4000-8000-000000000501";
        const ownerId = "20000000-0000-4000-8000-000000000501";
        const actorId = "30000000-0000-4000-8000-000000000501";
        const firstAuditEntryId = "40000000-0000-4000-8000-000000000501";
        const secondAuditEntryId = "40000000-0000-4000-8000-000000000502";
        const thirdAuditEntryId = "40000000-0000-4000-8000-000000000503";
        const newAuditEntryId = "40000000-0000-4000-8000-000000000504";

        try {
            await client.connect();
            await applyMigrationRange(client, 0, 13);
            await client.query(
                `INSERT INTO "expense_report" ("id", "owner", "due_date", "tenant_id")
                 VALUES ($1, $2, '2026-07-02', $3)`,
                [reportId, ownerId, tenantId],
            );
            await client.query(
                `INSERT INTO "audit_entry" ("id", "tenant_id", "expense_report_id", "actor_id", "action", "stage_before_action", "stage_after_proposed_action", "created_at")
                 VALUES
                    ($1, $2, $3, $4, 'report_created', 'Drafted', 'Drafted', '2026-07-02T10:00:00.000Z'),
                    ($5, $2, $3, $4, 'manager_reviewed', 'Drafted', 'Manager Approval', '2026-07-02T09:00:00.000Z'),
                    ($6, $2, $3, $4, 'ap_reviewed', 'Manager Approval', 'AP Review', '2026-07-02T09:00:00.000Z')`,
                [
                    thirdAuditEntryId,
                    tenantId,
                    reportId,
                    actorId,
                    secondAuditEntryId,
                    firstAuditEntryId,
                ],
            );

            await applyMigrationRange(client, 14, 15);

            const migratedAuditEntries = await client.query(
                `SELECT "id", "sequence" FROM "audit_entry" ORDER BY "sequence"`,
            );
            expect(migratedAuditEntries.rows).toEqual([
                { id: firstAuditEntryId, sequence: "1" },
                { id: secondAuditEntryId, sequence: "2" },
                { id: thirdAuditEntryId, sequence: "3" },
            ]);

            await client.query(
                `INSERT INTO "audit_entry" ("id", "tenant_id", "expense_report_id", "actor_id", "action", "stage_before_action", "stage_after_proposed_action")
                 VALUES ($1, $2, $3, $4, 'payment_stubbed', 'AP Review', 'Paid')`,
                [newAuditEntryId, tenantId, reportId, actorId],
            );
            const newAuditEntry = await client.query(
                `SELECT "sequence" FROM "audit_entry" WHERE "id" = $1`,
                [newAuditEntryId],
            );
            expect(newAuditEntry.rows[0]).toMatchObject({ sequence: "4" });

            await client.query(`
DO $$
BEGIN
    UPDATE "audit_entry" SET "action" = 'tampered' WHERE "id" = '${firstAuditEntryId}';
    RAISE EXCEPTION 'expected audit_entry update to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'audit_entry rows are append-only' THEN
            RAISE;
        END IF;
END;
$$;
`);
        } finally {
            await client.end().catch(() => undefined);
            await container.stop().catch(() => undefined);
        }
    }, 240000);
});
void describe("audit entry PostgreSQL constraints", () => {
    void test("prevents audit entry updates and deletes in PostgreSQL", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000401";
        const reportId = "10000000-0000-4000-8000-000000000401";
        const ownerId = "20000000-0000-4000-8000-000000000401";
        const actorId = "30000000-0000-4000-8000-000000000401";
        const auditEntryId = "40000000-0000-4000-8000-000000000401";
        const client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });

        try {
            await client.connect();
            await client.query("BEGIN");
            await client.query(
                `INSERT INTO "expense_report" ("id", "owner", "due_date", "tenant_id")
                 VALUES ($1, $2, '2026-07-02', $3)`,
                [reportId, ownerId, tenantId],
            );
            await client.query(
                `INSERT INTO "audit_entry" ("id", "tenant_id", "expense_report_id", "actor_id", "action", "stage_before_action", "stage_after_proposed_action")
                 VALUES ($1, $2, $3, $4, 'report_created', 'Drafted', 'Drafted')`,
                [auditEntryId, tenantId, reportId, actorId],
            );

            await client.query(`
DO $$
BEGIN
    UPDATE "audit_entry" SET "action" = 'tampered' WHERE "id" = '${auditEntryId}';
    RAISE EXCEPTION 'expected audit_entry update to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'audit_entry rows are append-only' THEN
            RAISE;
        END IF;
END;
$$;
`);

            await client.query(`
DO $$
BEGIN
    DELETE FROM "audit_entry" WHERE "id" = '${auditEntryId}';
    RAISE EXCEPTION 'expected audit_entry delete to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'audit_entry rows are append-only' THEN
            RAISE;
        END IF;
END;
$$;
`);
            await client.query("ROLLBACK");
        } finally {
            await client.end().catch(() => undefined);
        }
    });
});
void describe("case comment and attachment PostgreSQL constraints", () => {
    void test("enforces mutation triggers and attachment deletes in PostgreSQL", async () => {
        const tenantId = "00000000-0000-0000-0000-000000000083";
        const reportId = "10000000-0000-0000-0000-000000000083";
        const ownerId = "20000000-0000-0000-0000-000000000083";
        const authorId = "30000000-0000-0000-0000-000000000083";
        const commentId = "40000000-0000-0000-0000-000000000083";
        const attachmentId = "50000000-0000-0000-0000-000000000083";
        const client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });

        try {
            await client.connect();
            await client.query("BEGIN");
            await client.query(`
INSERT INTO "expense_report" ("id", "owner", "due_date", "tenant_id")
VALUES ('${reportId}', '${ownerId}', '2026-07-02', '${tenantId}');
`);

            await client.query(`
INSERT INTO "case_comment" ("id", "tenant_id", "expense_report_id", "author_id", "body")
VALUES ('${commentId}', '${tenantId}', '${reportId}', '${authorId}', 'Initial comment');
`);

            await client.query(`
INSERT INTO "attachment_metadata" ("id", "tenant_id", "expense_report_id", "filename", "content_type", "blob_reference")
VALUES ('${attachmentId}', '${tenantId}', '${reportId}', 'receipt.pdf', 'application/pdf', '{"bucket":"case-artifacts","key":"receipt.pdf"}');
`);

            await client.query(`
DO $$
BEGIN
    UPDATE "case_comment" SET "body" = 'edited' WHERE "id" = '${commentId}';
    RAISE EXCEPTION 'expected case_comment update to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'case_comment rows are append-only' THEN
            RAISE;
        END IF;
END;
$$;
`);

            await client.query(`
DO $$
BEGIN
    DELETE FROM "case_comment" WHERE "id" = '${commentId}';
    RAISE EXCEPTION 'expected case_comment delete to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'case_comment rows are append-only' THEN
            RAISE;
        END IF;
END;
$$;
`);

            await client.query(`
DO $$
BEGIN
    UPDATE "attachment_metadata" SET "filename" = 'corrected.pdf' WHERE "id" = '${attachmentId}';
    RAISE EXCEPTION 'expected attachment_metadata update to fail';
EXCEPTION
    WHEN others THEN
        IF SQLERRM <> 'attachment_metadata rows cannot be updated' THEN
            RAISE;
        END IF;
END;
$$;
`);

            await client.query(`
DELETE FROM "attachment_metadata" WHERE "id" = '${attachmentId}';
`);

            await client.query(`
DO $$
BEGIN
    INSERT INTO "attachment_metadata" ("tenant_id", "expense_report_id", "filename", "content_type", "blob_reference")
    VALUES ('${tenantId}', '${reportId}', 'receipt.bin', 'image', '{"bucket":"case-artifacts","key":"receipt.bin"}');
    RAISE EXCEPTION 'expected unsupported content_type to fail';
EXCEPTION
    WHEN check_violation THEN
        NULL;
END;
$$;
`);
            await client.query("ROLLBACK");
        } finally {
            await client.end().catch(() => undefined);
        }
    });
});

void describe("GL reference PostgreSQL constraints", () => {
    void test("seeds baseline mappings and enforces tenant-scoped uniqueness", async () => {
        const defaultTenantId = "40000000-0000-4000-8000-000000000300";
        const otherTenantId = "40000000-0000-4000-8000-000000000301";
        const otherGlCodeId = "10000000-0000-4000-8000-000000000981";
        const client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });

        try {
            await client.connect();
            await client.query("BEGIN");

            const seededMappings = await client.query(
                `SELECT mapping.category, code.account_code
                 FROM "gl_mapping" mapping
                 INNER JOIN "gl_code" code
                    ON code.tenant_id = mapping.tenant_id
                   AND code.id = mapping.gl_code_id
                 WHERE mapping.tenant_id = $1
                 ORDER BY mapping.category`,
                [defaultTenantId],
            );

            expect(seededMappings.rows).toEqual([
                { account_code: "6200", category: "Lodging" },
                { account_code: "6100", category: "Meals" },
                { account_code: "6300", category: "Mileage" },
                { account_code: "6400", category: "Office Supplies" },
                { account_code: "6999", category: "Other" },
                { account_code: "6500", category: "Software" },
                { account_code: "6000", category: "Travel" },
            ]);

            await client.query(`
DO $$
BEGIN
    INSERT INTO "gl_mapping" ("tenant_id", "category", "gl_code_id")
    VALUES ('${defaultTenantId}', 'Travel', '10000000-0000-4000-8000-000000000901');
    RAISE EXCEPTION 'expected duplicate tenant category mapping to fail';
EXCEPTION
    WHEN unique_violation THEN
        NULL;
END;
$$;
`);

            await client.query(
                `INSERT INTO "gl_code" ("id", "tenant_id", "account_code", "account_name")
                 VALUES ($1, $2, '6000', 'Travel Expense')`,
                [otherGlCodeId, otherTenantId],
            );
            await client.query(
                `INSERT INTO "gl_mapping" ("tenant_id", "category", "gl_code_id")
                 VALUES ($1, 'Travel', $2)`,
                [otherTenantId, otherGlCodeId],
            );

            const otherTenantMapping = await client.query(
                `SELECT COUNT(*) as count
                 FROM "gl_mapping"
                 WHERE "tenant_id" = $1 AND "category" = 'Travel'`,
                [otherTenantId],
            );

            expect(otherTenantMapping.rows[0]).toMatchObject({ count: "1" });

            await client.query(`
DO $$
BEGIN
    INSERT INTO "gl_mapping" ("tenant_id", "category", "gl_code_id")
    VALUES ('${otherTenantId}', 'Meals', '10000000-0000-4000-8000-000000000902');
    RAISE EXCEPTION 'expected cross-tenant GL code mapping to fail';
EXCEPTION
    WHEN foreign_key_violation THEN
        NULL;
END;
$$;
`);

            await client.query("ROLLBACK");
        } finally {
            await client.end().catch(() => undefined);
        }
    });
});

void describe("check migrations", () => {
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
        "Check table, constraints, and indexes exist",
        async (table) => {
            const table_exists_query_result = await client.query(
                "SELECT COUNT(*) as count FROM pg_catalog.pg_tables WHERE tablename = $1",
                [table.name],
            );

            expect(table_exists_query_result.rowCount).toEqual(1);
            expect(table_exists_query_result.rows[0]).toMatchObject({
                count: "1",
            });

            const constraints = table.checks.map((check) => check.name);
            const constraints_exist_query_result = await client.query(
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

            expect(constraints_exist_query_result.rowCount).toEqual(1);
            expect(constraints_exist_query_result.rows[0]).toMatchObject({
                count: constraints.length.toString(),
            });

            const indexes = table.indexes
                .map((index) => index.config.name)
                .filter((index) => index !== undefined);
            const indexes_exist_query_result = await client.query(
                "SELECT COUNT(*) as count FROM pg_indexes WHERE tablename = $1 AND indexname = ANY($2)",
                [table.name, indexes],
            );

            expect(indexes_exist_query_result.rowCount).toEqual(1);
            expect(indexes_exist_query_result.rows[0]).toMatchObject({
                count: indexes.length.toString(),
            });
        },
    );
});
