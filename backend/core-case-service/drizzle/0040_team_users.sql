ALTER TABLE "user" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_status_check" CHECK ("user"."status" in ('invited', 'active', 'deactivated'));--> statement-breakpoint
ALTER TABLE "reference_data_audit_entry" DROP CONSTRAINT "reference_data_audit_entry_entity_type_check";--> statement-breakpoint
ALTER TABLE "reference_data_audit_entry" ADD CONSTRAINT "reference_data_audit_entry_entity_type_check" CHECK ("reference_data_audit_entry"."entity_type" in ('gl_mapping', 'user'));--> statement-breakpoint
ALTER TABLE "reference_data_audit_entry" DROP CONSTRAINT "reference_data_audit_entry_action_check";--> statement-breakpoint
ALTER TABLE "reference_data_audit_entry" ADD CONSTRAINT "reference_data_audit_entry_action_check" CHECK ("reference_data_audit_entry"."action" in ('gl_mapping_updated', 'user_invited', 'user_role_changed', 'user_status_changed'));
