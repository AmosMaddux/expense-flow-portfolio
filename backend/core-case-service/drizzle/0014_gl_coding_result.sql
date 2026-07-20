CREATE TABLE "gl_coding_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"category" text NOT NULL,
	"mapping_status" text NOT NULL,
	"gl_account_code" text,
	"gl_account_name" text,
	"amount" numeric(12, 2),
	"currency" text,
	"flagged_line_item" boolean DEFAULT false NOT NULL,
	"flag_code" text,
	"flag_message" text,
	"coded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_coding_result_source_type_check" CHECK ("gl_coding_result"."source_type" in ('line_item', 'mileage')),
	CONSTRAINT "gl_coding_result_mapping_status_check" CHECK ("gl_coding_result"."mapping_status" in ('mapped', 'unmapped'))
);
--> statement-breakpoint
ALTER TABLE "gl_coding_result" ADD CONSTRAINT "gl_coding_result_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "gl_coding_result_tenant_source_coded_at_idx" ON "gl_coding_result" USING btree ("tenant_id","source_type","source_id","coded_at");
--> statement-breakpoint
CREATE INDEX "gl_coding_result_tenant_submission_idx" ON "gl_coding_result" USING btree ("tenant_id","submission_id");
