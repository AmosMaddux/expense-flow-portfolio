CREATE TABLE "stage_transition_projection" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"previous_stage" text NOT NULL,
	"current_stage" text NOT NULL,
	"transitioned_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_transition_projection_previous_stage_check" CHECK ("stage_transition_projection"."previous_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_projection_current_stage_check" CHECK ("stage_transition_projection"."current_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_projection_changed_stage_check" CHECK ("stage_transition_projection"."previous_stage" <> "stage_transition_projection"."current_stage")
);
--> statement-breakpoint
CREATE INDEX "stage_transition_projection_tenant_report_idx" ON "stage_transition_projection" USING btree ("tenant_id","expense_report_id","transitioned_at");--> statement-breakpoint
CREATE INDEX "stage_transition_projection_correlation_idx" ON "stage_transition_projection" USING btree ("correlation_id");