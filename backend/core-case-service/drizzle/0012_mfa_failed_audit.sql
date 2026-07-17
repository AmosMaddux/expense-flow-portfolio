ALTER TABLE "authentication_audit_entry" DROP CONSTRAINT "authentication_audit_entry_action_check";--> statement-breakpoint
ALTER TABLE "authentication_audit_entry" ADD CONSTRAINT "authentication_audit_entry_action_check" CHECK ("authentication_audit_entry"."action" in ('login_failed', 'mfa_failed'));
