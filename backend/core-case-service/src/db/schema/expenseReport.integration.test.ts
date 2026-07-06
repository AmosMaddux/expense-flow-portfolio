import { describe, test } from "vitest";
import { Client } from "pg";

import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

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
