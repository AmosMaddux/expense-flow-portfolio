CREATE TABLE "line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_expense_report_id_expense_report_id_fk" FOREIGN KEY ("expense_report_id") REFERENCES "public"."expense_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Supports tenant-scoped lookups of line items attached to an Expense Report.
CREATE INDEX "line_item_tenant_expense_report_idx" ON "line_item" USING btree ("tenant_id","expense_report_id");
