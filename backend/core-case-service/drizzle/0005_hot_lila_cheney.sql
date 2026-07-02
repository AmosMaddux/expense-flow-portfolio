CREATE TABLE "attachment_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"blob_reference" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_metadata_filename_not_blank_check" CHECK (nullif(btrim("attachment_metadata"."filename"), '') is not null),
	CONSTRAINT "attachment_metadata_content_type_check" CHECK ("attachment_metadata"."content_type" in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/json'))
);
--> statement-breakpoint
CREATE TABLE "case_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_report_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_comment_body_not_blank_check" CHECK (nullif(btrim("case_comment"."body"), '') is not null)
);
--> statement-breakpoint
ALTER TABLE "attachment_metadata" ADD CONSTRAINT "attachment_metadata_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_comment" ADD CONSTRAINT "case_comment_expense_report_tenant_fk" FOREIGN KEY ("tenant_id","expense_report_id") REFERENCES "public"."expense_report"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_metadata_tenant_report_idx" ON "attachment_metadata" USING btree ("tenant_id","expense_report_id");--> statement-breakpoint
CREATE INDEX "case_comment_tenant_report_created_at_idx" ON "case_comment" USING btree ("tenant_id","expense_report_id","created_at");--> statement-breakpoint
CREATE INDEX "case_comment_tenant_author_created_at_idx" ON "case_comment" USING btree ("tenant_id","author_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_case_comment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'case_comment rows are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER case_comment_prevent_mutation_trigger
BEFORE UPDATE OR DELETE ON "case_comment"
FOR EACH ROW
EXECUTE FUNCTION prevent_case_comment_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_attachment_metadata_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'attachment_metadata rows cannot be updated';
END;
$$;--> statement-breakpoint
CREATE TRIGGER attachment_metadata_prevent_update_trigger
BEFORE UPDATE ON "attachment_metadata"
FOR EACH ROW
EXECUTE FUNCTION prevent_attachment_metadata_update();
