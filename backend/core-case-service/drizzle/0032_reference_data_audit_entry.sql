CREATE TABLE "reference_data_audit_entry" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "actor_id" uuid NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" uuid NOT NULL,
    "action" text NOT NULL,
    "before" jsonb NOT NULL,
    "after" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "reference_data_audit_entry_entity_type_check" CHECK ("reference_data_audit_entry"."entity_type" in ('gl_mapping')),
    CONSTRAINT "reference_data_audit_entry_action_check" CHECK ("reference_data_audit_entry"."action" in ('gl_mapping_updated'))
);
--> statement-breakpoint
CREATE INDEX "reference_data_audit_entry_tenant_entity_idx" ON "reference_data_audit_entry" USING btree ("tenant_id","entity_type","entity_id","created_at");
--> statement-breakpoint
CREATE INDEX "reference_data_audit_entry_tenant_actor_idx" ON "reference_data_audit_entry" USING btree ("tenant_id","actor_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_reference_data_audit_entry_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'reference_data_audit_entry rows are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reference_data_audit_entry_prevent_mutation_trigger
BEFORE UPDATE OR DELETE ON "reference_data_audit_entry"
FOR EACH ROW
EXECUTE FUNCTION prevent_reference_data_audit_entry_mutation();
