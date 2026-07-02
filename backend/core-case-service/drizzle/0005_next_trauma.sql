CREATE TABLE "stage_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"actor" uuid NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_transition_from_stage_check" CHECK ("stage_transition"."from_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_to_stage_check" CHECK ("stage_transition"."to_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_reason_check" CHECK (nullif(btrim("stage_transition"."reason"), '') is not null),
	CONSTRAINT "stage_transition_valid_edge_check" CHECK ((("stage_transition"."from_stage" = 'Drafted' and "stage_transition"."to_stage" = 'Submitted') or ("stage_transition"."from_stage" = 'Submitted' and "stage_transition"."to_stage" = 'Manager Approval') or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'AP Review') or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Paid') or ("stage_transition"."from_stage" = 'Paid' and "stage_transition"."to_stage" = 'Reconciled') or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'Drafted') or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Drafted')))
);
--> statement-breakpoint
ALTER TABLE "stage_transition" ADD CONSTRAINT "stage_transition_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_transition_tenant_report_idx" ON "stage_transition" USING btree ("tenant_id","expense_report_id");--> statement-breakpoint
CREATE INDEX "stage_transition_tenant_occurred_at_idx" ON "stage_transition" USING btree ("tenant_id","occurred_at");