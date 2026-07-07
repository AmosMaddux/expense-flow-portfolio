DROP TRIGGER IF EXISTS audit_entry_prevent_mutation_trigger ON "audit_entry";
DROP FUNCTION IF EXISTS prevent_audit_entry_mutation;

DROP INDEX IF EXISTS "audit_entry_tenant_actor_created_at_idx";
DROP INDEX IF EXISTS "audit_entry_tenant_report_created_at_idx";

ALTER TABLE IF EXISTS "audit_entry" DROP CONSTRAINT "audit_entry_expense_report_tenant_fk";

DROP TABLE IF EXISTS "audit_entry";