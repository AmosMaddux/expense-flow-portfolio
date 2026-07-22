CREATE TABLE "mfa_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"secret_key_version" text NOT NULL,
	"algorithm" text NOT NULL,
	"digits" integer NOT NULL,
	"period_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_enrollment_secret_ciphertext_not_blank_check" CHECK (nullif(btrim("mfa_enrollment"."secret_ciphertext"), '') is not null),
	CONSTRAINT "mfa_enrollment_secret_iv_not_blank_check" CHECK (nullif(btrim("mfa_enrollment"."secret_iv"), '') is not null),
	CONSTRAINT "mfa_enrollment_secret_auth_tag_not_blank_check" CHECK (nullif(btrim("mfa_enrollment"."secret_auth_tag"), '') is not null),
	CONSTRAINT "mfa_enrollment_secret_key_version_not_blank_check" CHECK (nullif(btrim("mfa_enrollment"."secret_key_version"), '') is not null),
	CONSTRAINT "mfa_enrollment_algorithm_check" CHECK ("mfa_enrollment"."algorithm" in ('SHA1')),
	CONSTRAINT "mfa_enrollment_digits_check" CHECK ("mfa_enrollment"."digits" in (6, 8)),
	CONSTRAINT "mfa_enrollment_period_seconds_positive_check" CHECK ("mfa_enrollment"."period_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "mfa_enrollment" ADD CONSTRAINT "mfa_enrollment_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_enrollment_tenant_user_unique_idx" ON "mfa_enrollment" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "mfa_enrollment_tenant_user_idx" ON "mfa_enrollment" USING btree ("tenant_id","user_id");
