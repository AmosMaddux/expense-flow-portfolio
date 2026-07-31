CREATE TABLE "stage_transition_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_transition_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_id" uuid,
	"published_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	CONSTRAINT "stage_transition_outbox_from_stage_check" CHECK ("stage_transition_outbox"."from_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_outbox_to_stage_check" CHECK ("stage_transition_outbox"."to_stage" in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')),
	CONSTRAINT "stage_transition_outbox_changed_stage_check" CHECK ("stage_transition_outbox"."from_stage" <> "stage_transition_outbox"."to_stage"),
	CONSTRAINT "stage_transition_outbox_attempt_count_check" CHECK ("stage_transition_outbox"."attempt_count" >= 0),
	CONSTRAINT "stage_transition_outbox_lock_check" CHECK (("stage_transition_outbox"."lock_id" is null and "stage_transition_outbox"."locked_until" is null) or ("stage_transition_outbox"."lock_id" is not null and "stage_transition_outbox"."locked_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "stage_transition_outbox" ADD CONSTRAINT "stage_transition_outbox_stage_transition_id_stage_transition_id_fk" FOREIGN KEY ("stage_transition_id") REFERENCES "public"."stage_transition"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stage_transition_outbox" ADD CONSTRAINT "stage_transition_outbox_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "stage_transition_outbox_transition_unique_idx" ON "stage_transition_outbox" USING btree ("stage_transition_id");
--> statement-breakpoint
CREATE INDEX "stage_transition_outbox_dispatch_idx" ON "stage_transition_outbox" USING btree ("published_at","dead_lettered_at","next_attempt_at","locked_until");
