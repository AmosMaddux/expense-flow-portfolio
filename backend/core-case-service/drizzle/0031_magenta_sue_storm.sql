CREATE TABLE "tenant_expense_policy" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"policy_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_expense_policy_text_not_blank_check" CHECK (nullif(btrim("tenant_expense_policy"."policy_text"), '') is not null)
);
