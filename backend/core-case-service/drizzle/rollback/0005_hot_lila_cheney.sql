DROP TRIGGER IF EXISTS attachment_metadata_prevent_update_trigger ON "attachment_metadata";
DROP FUNCTION IF EXISTS prevent_attachment_metadata_update;

DROP TRIGGER IF EXISTS case_comment_prevent_mutation_trigger ON "case_comment";
DROP FUNCTION IF EXISTS prevent_case_comment_mutation;

DROP INDEX IF EXISTS case_comment_tenant_author_created_at_idx;
DROP INDEX IF EXISTS case_comment_tenant_report_created_at_idx;
DROP INDEX IF EXISTS attachment_metadata_tenant_report_idx;

ALTER TABLE IF EXISTS "case_comment" DROP CONSTRAINT "case_comment_expense_report_tenant_fk";
ALTER TABLE IF EXISTS "attachment_metadata" DROP CONSTRAINT "attachment_metadata_expense_report_tenant_fk";

DROP TABLE IF EXISTS "case_comment";
DROP TABLE IF EXISTS "attachment_metadata";
