CREATE TABLE "alert_disposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alert_id" text NOT NULL,
	"alert_name" text NOT NULL,
	"source" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"resolution" text NOT NULL,
	"correlation_id" uuid,
	"trace_id" text,
	"investigated_by" uuid NOT NULL,
	"notes" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_disposition_alert_id_not_blank_check" CHECK (nullif(btrim("alert_disposition"."alert_id"), '') is not null),
	CONSTRAINT "alert_disposition_alert_name_not_blank_check" CHECK (nullif(btrim("alert_disposition"."alert_name"), '') is not null),
	CONSTRAINT "alert_disposition_source_not_blank_check" CHECK (nullif(btrim("alert_disposition"."source"), '') is not null),
	CONSTRAINT "alert_disposition_severity_check" CHECK ("alert_disposition"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "alert_disposition_status_check" CHECK ("alert_disposition"."status" in ('investigated', 'resolved', 'monitoring', 'escalated')),
	CONSTRAINT "alert_disposition_resolution_not_blank_check" CHECK (nullif(btrim("alert_disposition"."resolution"), '') is not null),
	CONSTRAINT "alert_disposition_trace_id_check" CHECK ("alert_disposition"."trace_id" is null or "alert_disposition"."trace_id" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE INDEX "alert_disposition_tenant_created_at_idx" ON "alert_disposition" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_disposition_tenant_alert_idx" ON "alert_disposition" USING btree ("tenant_id","alert_id");--> statement-breakpoint
CREATE INDEX "alert_disposition_tenant_correlation_idx" ON "alert_disposition" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "alert_disposition_tenant_trace_idx" ON "alert_disposition" USING btree ("tenant_id","trace_id");--> statement-breakpoint
