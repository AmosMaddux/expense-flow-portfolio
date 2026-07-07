CREATE INDEX "expense_report_tenant_stage_due_date_idx" ON "expense_report" USING btree ("tenant_id","current_stage","due_date");
