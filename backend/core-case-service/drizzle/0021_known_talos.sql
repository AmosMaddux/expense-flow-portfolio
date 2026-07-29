ALTER TABLE "line_item" ALTER COLUMN "expense_date" DROP DEFAULT;
CREATE UNIQUE INDEX "expense_report_one_draft_per_owner_idx" ON "expense_report" USING btree ("tenant_id","owner") WHERE "expense_report"."current_stage" = 'Drafted';
