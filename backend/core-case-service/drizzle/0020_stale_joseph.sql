ALTER TABLE "line_item" ADD COLUMN "expense_date" date;
UPDATE "line_item"
SET "expense_date" = ("created_at" AT TIME ZONE 'UTC')::date
WHERE "expense_date" IS NULL;
ALTER TABLE "line_item" ALTER COLUMN "expense_date" SET NOT NULL;
