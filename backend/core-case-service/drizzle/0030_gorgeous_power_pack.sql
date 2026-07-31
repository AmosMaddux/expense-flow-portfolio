CREATE TABLE "expense_report_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"payment_id" text,
	"status" text DEFAULT 'issuing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_report_settlement_status_check" CHECK ("expense_report_settlement"."status" in ('issuing', 'issued', 'compensated', 'reconciled')),
	CONSTRAINT "expense_report_settlement_payment_id_check" CHECK (("expense_report_settlement"."status" = 'issuing' and "expense_report_settlement"."payment_id" is null) or ("expense_report_settlement"."status" <> 'issuing' and nullif(btrim("expense_report_settlement"."payment_id"), '') is not null))
);
--> statement-breakpoint
ALTER TABLE "stage_transition" DROP CONSTRAINT "stage_transition_valid_edge_check";--> statement-breakpoint
ALTER TABLE "expense_report_settlement" ADD CONSTRAINT "expense_report_settlement_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_report_settlement_report_unique_idx" ON "expense_report_settlement" USING btree ("tenant_id","expense_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_report_settlement_idempotency_unique_idx" ON "expense_report_settlement" USING btree ("tenant_id","expense_report_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "expense_report_settlement_tenant_status_idx" ON "expense_report_settlement" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "stage_transition" ADD CONSTRAINT "stage_transition_valid_edge_check" CHECK ((
                ("stage_transition"."from_stage" = 'Drafted' and "stage_transition"."to_stage" = 'Drafted' and "stage_transition"."reason" = 'report_created')
                or ("stage_transition"."from_stage" = 'Drafted' and "stage_transition"."to_stage" = 'Submitted')
                or ("stage_transition"."from_stage" = 'Submitted' and "stage_transition"."to_stage" = 'Manager Approval')
                or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'AP Review')
                or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Paid')
                or ("stage_transition"."from_stage" = 'Paid' and "stage_transition"."to_stage" = 'Reconciled')
                or ("stage_transition"."from_stage" = 'Paid' and "stage_transition"."to_stage" = 'AP Review' and "stage_transition"."reason" = 'settlement_saga_compensated')
                or ("stage_transition"."from_stage" = 'Manager Approval' and "stage_transition"."to_stage" = 'Drafted')
                or ("stage_transition"."from_stage" = 'AP Review' and "stage_transition"."to_stage" = 'Drafted')
                or ("stage_transition"."from_stage" = "stage_transition"."to_stage" and "stage_transition"."reason" like 'transition_denied:%')
            ));