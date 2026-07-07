DROP INDEX IF EXISTS "line_item_tenant_expense_report_idx";
ALTER TABLE IF EXISTS "line_item" DROP CONSTRAINT "line_item_expense_report_id_expense_report_id_fk";

DROP TABLE IF EXISTS "line_item";
