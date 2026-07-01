ALTER TABLE "line_item" DROP CONSTRAINT "line_item_expense_report_id_expense_report_id_fk";
--> statement-breakpoint
-- Composite child-table FKs need this key to prove tenant_id matches the parent report.
CREATE UNIQUE INDEX "expense_report_tenant_id_unique_idx" ON "expense_report" USING btree ("tenant_id","id");--> statement-breakpoint
-- Replace the report-only FK so line items cannot attach across tenant boundaries.
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_tenant_expense_report_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;
