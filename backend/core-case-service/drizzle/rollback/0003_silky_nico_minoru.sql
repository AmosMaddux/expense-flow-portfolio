DROP INDEX IF EXISTS "receipt_metadata_tenant_report_idx";
DROP INDEX IF EXISTS "mileage_entry_tenant_report_idx";
ALTER TABLE IF EXISTS "receipt_metadata" DROP CONSTRAINT "receipt_metadata_expense_report_tenant_fk";
ALTER TABLE IF EXISTS "mileage_entry" DROP CONSTRAINT "mileage_entry_expense_report_tenant_fk";

DROP TABLE IF EXISTS "mileage_entry";
DROP TABLE IF EXISTS "receipt_metadata";
