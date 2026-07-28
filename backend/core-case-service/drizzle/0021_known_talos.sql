ALTER TABLE "line_item" ADD COLUMN IF NOT EXISTS "expense_date" date;
UPDATE "line_item"
SET "expense_date" = ("created_at" AT TIME ZONE 'UTC')::date
WHERE "expense_date" IS NULL;
ALTER TABLE "line_item" ALTER COLUMN "expense_date" SET NOT NULL;
ALTER TABLE "line_item" ALTER COLUMN "expense_date" DROP DEFAULT;
CREATE UNIQUE INDEX "expense_report_one_draft_per_owner_idx" ON "expense_report" USING btree ("tenant_id","owner") WHERE "expense_report"."current_stage" = 'Drafted';
