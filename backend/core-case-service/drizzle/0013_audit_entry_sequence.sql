ALTER TABLE "audit_entry" ADD COLUMN "sequence" bigint;--> statement-breakpoint
CREATE SEQUENCE "audit_entry_sequence_seq" OWNED BY "audit_entry"."sequence";--> statement-breakpoint
UPDATE "audit_entry"
SET "sequence" = ordered.next_sequence
FROM (
    SELECT "id", nextval('"audit_entry_sequence_seq"') AS next_sequence
    FROM "audit_entry"
    ORDER BY "created_at", "id"
) ordered
WHERE "audit_entry"."id" = ordered."id";--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "sequence" SET DEFAULT nextval('"audit_entry_sequence_seq"');--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_entry_tenant_report_created_sequence_idx" ON "audit_entry" USING btree ("tenant_id","expense_report_id","created_at","sequence");
