CREATE TABLE "authentication_audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authentication_audit_entry_action_check" CHECK ("authentication_audit_entry"."action" in ('login_failed')),
	CONSTRAINT "authentication_audit_entry_email_not_blank_check" CHECK (nullif(btrim("authentication_audit_entry"."email"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"password_hash_algorithm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_password_hash_not_blank_check" CHECK (nullif(btrim("credential"."password_hash"), '') is not null),
	CONSTRAINT "credential_password_hash_algorithm_not_blank_check" CHECK (nullif(btrim("credential"."password_hash_algorithm"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_token_hash_not_blank_check" CHECK (nullif(btrim("refresh_token"."token_hash"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_check" CHECK ("role"."name" in ('Finance Admin', 'Department Manager', 'Employee', 'Admin'))
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_not_blank_check" CHECK (nullif(btrim("user"."email"), '') is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_tenant_id_unique_idx" ON "user" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "authentication_audit_entry" ADD CONSTRAINT "authentication_audit_entry_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authentication_audit_entry_tenant_created_at_idx" ON "authentication_audit_entry" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "authentication_audit_entry_tenant_user_created_at_idx" ON "authentication_audit_entry" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_tenant_user_unique_idx" ON "credential" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "credential_tenant_user_idx" ON "credential" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_token_hash_unique_idx" ON "refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_token_tenant_user_idx" ON "refresh_token" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_tenant_expires_at_idx" ON "refresh_token" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_tenant_user_name_unique_idx" ON "role" USING btree ("tenant_id","user_id","name");--> statement-breakpoint
CREATE INDEX "role_tenant_name_idx" ON "role" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "role_tenant_user_idx" ON "role" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tenant_email_unique_idx" ON "user" USING btree ("tenant_id",lower("email"));
