CREATE TABLE "mileage_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route" text NOT NULL,
	"distance" numeric(8, 2) NOT NULL,
	"mileage_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"merchant" text NOT NULL,
	"receipt_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"blob_reference" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_report_tenant_id_id_uidx" ON "expense_report" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "mileage_entry" ADD CONSTRAINT "mileage_entry_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_metadata" ADD CONSTRAINT "receipt_metadata_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mileage_entry_tenant_report_idx" ON "mileage_entry" USING btree ("tenant_id","expense_report_id");--> statement-breakpoint
CREATE INDEX "receipt_metadata_tenant_report_idx" ON "receipt_metadata" USING btree ("tenant_id","expense_report_id");
