CREATE TABLE "expense_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_stage" text DEFAULT 'Drafted' NOT NULL,
	"on_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"owner" uuid NOT NULL,
	"priority" text DEFAULT 'Normal' NOT NULL,
	"due_date" date NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_report_current_stage_check" CHECK ("expense_report"."current_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "expense_report_priority_check" CHECK ("expense_report"."priority" in ('Low', 'Normal', 'High', 'Urgent')),
	CONSTRAINT "expense_report_hold_reason_check" CHECK (("expense_report"."on_hold" = true and nullif(btrim("expense_report"."hold_reason"), '') is not null) or ("expense_report"."on_hold" = false and "expense_report"."hold_reason" is null))
);
--> statement-breakpoint
CREATE INDEX "expense_report_tenant_stage_idx" ON "expense_report" USING btree ("tenant_id","current_stage");--> statement-breakpoint
CREATE INDEX "expense_report_tenant_due_date_idx" ON "expense_report" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "expense_report_tenant_owner_idx" ON "expense_report" USING btree ("tenant_id","owner");--> statement-breakpoint
CREATE INDEX "expense_report_tenant_priority_idx" ON "expense_report" USING btree ("tenant_id","priority");