DROP INDEX IF EXISTS "stage_transition_tenant_occurred_at_idx";
DROP INDEX IF EXISTS "stage_transition_tenant_report_idx";

ALTER TABLE IF EXISTS "stage_transition" DROP CONSTRAINT "stage_transition_expense_report_tenant_fk";

DROP TABLE IF EXISTS "stage_transition";
