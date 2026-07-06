ALTER TABLE IF EXISTS "line_item" DROP CONSTRAINT "line_item_tenant_expense_report_fk";
DROP INDEX IF EXISTS "expense_report_tenant_id_unique_idx";

ALTER TABLE IF EXISTS "line_item" ADD CONSTRAINT "line_item_expense_report_id_expense_report_id_fk" FOREIGN KEY ("expense_report_id") REFERENCES "public"."expense_report"("id") ON DELETE no action ON UPDATE no action;
