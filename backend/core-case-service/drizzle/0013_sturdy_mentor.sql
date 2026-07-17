CREATE TABLE "tenant_rate_limit_window" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	CONSTRAINT "tenant_rate_limit_window_request_count_positive_check" CHECK ("tenant_rate_limit_window"."request_count" > 0)
);
