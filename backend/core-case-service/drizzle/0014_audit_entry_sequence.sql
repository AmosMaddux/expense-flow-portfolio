ALTER TABLE "audit_entry" ADD COLUMN "sequence" bigint;--> statement-breakpoint
CREATE SEQUENCE "audit_entry_sequence_seq" OWNED BY "audit_entry"."sequence";--> statement-breakpoint
ALTER TABLE "audit_entry" DISABLE TRIGGER "audit_entry_prevent_mutation_trigger";--> statement-breakpoint
WITH ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS next_sequence
    FROM "audit_entry"
)
UPDATE "audit_entry"
SET "sequence" = ordered.next_sequence
FROM ordered
WHERE "audit_entry"."id" = ordered."id";--> statement-breakpoint
SELECT setval(
    '"audit_entry_sequence_seq"',
    COALESCE((SELECT MAX("sequence") FROM "audit_entry"), 1),
    (SELECT COUNT(*) > 0 FROM "audit_entry")
);--> statement-breakpoint
ALTER TABLE "audit_entry" ENABLE TRIGGER "audit_entry_prevent_mutation_trigger";--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "sequence" SET DEFAULT nextval('"audit_entry_sequence_seq"');--> statement-breakpoint
ALTER TABLE "audit_entry" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_entry_tenant_report_sequence_idx" ON "audit_entry" USING btree ("tenant_id","expense_report_id","sequence");

