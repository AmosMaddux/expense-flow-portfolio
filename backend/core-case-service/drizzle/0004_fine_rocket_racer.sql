CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"stage_before_action" text NOT NULL,
	"stage_after_proposed_action" text NOT NULL,
	"denial_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_entry_denial_reason_check" CHECK (("audit_entry"."action" <> 'transition_denied' or nullif(btrim("audit_entry"."denial_reason"), '') is not null) and ("audit_entry"."action" <> 'transition_approved' or "audit_entry"."denial_reason" is null)),
	CONSTRAINT "audit_entry_stage_before_action_check" CHECK ("audit_entry"."stage_before_action" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "audit_entry_stage_after_proposed_action_check" CHECK ("audit_entry"."stage_after_proposed_action" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled'))
);
--> statement-breakpoint
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entry_tenant_report_created_at_idx" ON "audit_entry" USING btree ("tenant_id","expense_report_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entry_tenant_actor_created_at_idx" ON "audit_entry" USING btree ("tenant_id","actor_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_entry_mutation()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_entry rows are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_entry_prevent_mutation_trigger
BEFORE UPDATE OR DELETE ON "audit_entry"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_entry_mutation();
