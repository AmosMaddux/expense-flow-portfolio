ALTER TABLE "line_item" DROP CONSTRAINT "line_item_expense_report_id_expense_report_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_report_tenant_id_unique_idx" ON "expense_report" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_tenant_expense_report_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;
