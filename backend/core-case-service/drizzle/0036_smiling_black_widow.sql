CREATE TABLE "tenant_expense_policy_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_hash" text NOT NULL,
	"chunk_hash" text NOT NULL,
	"section" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_expense_policy_chunk_content_not_blank_check" CHECK (nullif(btrim("tenant_expense_policy_chunk"."content"), '') is not null),
	CONSTRAINT "tenant_expense_policy_chunk_section_not_blank_check" CHECK (nullif(btrim("tenant_expense_policy_chunk"."section"), '') is not null),
	CONSTRAINT "tenant_expense_policy_chunk_index_check" CHECK ("tenant_expense_policy_chunk"."chunk_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stage_transition_projection" DROP CONSTRAINT "stage_transition_projection_valid_edge_check";--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_expense_policy_chunk_policy_index_unique" ON "tenant_expense_policy_chunk" USING btree ("tenant_id","policy_hash","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_expense_policy_chunk_hash_unique" ON "tenant_expense_policy_chunk" USING btree ("tenant_id","chunk_hash");--> statement-breakpoint
CREATE INDEX "tenant_expense_policy_chunk_tenant_idx" ON "tenant_expense_policy_chunk" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_expense_policy_chunk_tenant_section_idx" ON "tenant_expense_policy_chunk" USING btree ("tenant_id","section");--> statement-breakpoint
CREATE INDEX "tenant_expense_policy_chunk_tenant_policy_idx" ON "tenant_expense_policy_chunk" USING btree ("tenant_id","policy_hash");--> statement-breakpoint
ALTER TABLE "stage_transition_projection" ADD CONSTRAINT "stage_transition_projection_valid_edge_check" CHECK ((
                ("stage_transition_projection"."previous_stage" = 'Drafted' and "stage_transition_projection"."current_stage" = 'Submitted')
                or ("stage_transition_projection"."previous_stage" = 'Submitted' and "stage_transition_projection"."current_stage" = 'Manager Approval')
                or ("stage_transition_projection"."previous_stage" = 'Manager Approval' and "stage_transition_projection"."current_stage" = 'AP Review')
                or ("stage_transition_projection"."previous_stage" = 'AP Review' and "stage_transition_projection"."current_stage" = 'Paid')
                or ("stage_transition_projection"."previous_stage" = 'Paid' and "stage_transition_projection"."current_stage" = 'Reconciled')
                or ("stage_transition_projection"."previous_stage" = 'Paid' and "stage_transition_projection"."current_stage" = 'AP Review')
                or ("stage_transition_projection"."previous_stage" = 'Manager Approval' and "stage_transition_projection"."current_stage" = 'Drafted')
                or ("stage_transition_projection"."previous_stage" = 'AP Review' and "stage_transition_projection"."current_stage" = 'Drafted')
            ));