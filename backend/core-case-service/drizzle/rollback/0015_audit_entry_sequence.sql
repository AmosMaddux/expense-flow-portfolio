DROP INDEX IF EXISTS "audit_entry_tenant_report_sequence_idx";
ALTER TABLE "audit_entry" DROP COLUMN IF EXISTS "sequence";
DROP SEQUENCE IF EXISTS "audit_entry_sequence_seq";
