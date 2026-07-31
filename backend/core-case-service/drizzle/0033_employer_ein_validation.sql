ALTER TABLE "expense_report" ADD COLUMN "employer_ein" text;
ALTER TABLE "expense_report" ADD COLUMN "employer_legal_name" text;
ALTER TABLE "expense_report" ADD COLUMN "employer_ein_validation_status" text;
ALTER TABLE "expense_report" ADD COLUMN "employer_ein_validation_reason" text;
ALTER TABLE "expense_report" ADD COLUMN "employer_ein_service_reference_id" text;
ALTER TABLE "expense_report" ADD COLUMN "employer_ein_validated_at" timestamp with time zone;

ALTER TABLE "expense_report" ADD CONSTRAINT "expense_report_employer_ein_check" CHECK ("expense_report"."employer_ein" is null or "expense_report"."employer_ein" ~ '^[0-9]{9}$');
ALTER TABLE "expense_report" ADD CONSTRAINT "expense_report_employer_legal_name_check" CHECK ("expense_report"."employer_legal_name" is null or nullif(btrim("expense_report"."employer_legal_name"), '') is not null);
ALTER TABLE "expense_report" ADD CONSTRAINT "expense_report_employer_ein_validation_status_check" CHECK ("expense_report"."employer_ein_validation_status" is null or "expense_report"."employer_ein_validation_status" in ('valid', 'invalid', 'unreachable'));
ALTER TABLE "expense_report" ADD CONSTRAINT "expense_report_employer_ein_validation_complete_check" CHECK (("expense_report"."employer_ein" is null and "expense_report"."employer_legal_name" is null and "expense_report"."employer_ein_validation_status" is null and "expense_report"."employer_ein_validation_reason" is null and "expense_report"."employer_ein_service_reference_id" is null and "expense_report"."employer_ein_validated_at" is null) or ("expense_report"."employer_ein" is not null and "expense_report"."employer_legal_name" is not null and "expense_report"."employer_ein_validation_status" is not null and "expense_report"."employer_ein_validated_at" is not null));

ALTER TABLE "audit_entry" DROP CONSTRAINT "audit_entry_denial_reason_check";
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_denial_reason_check" CHECK (("audit_entry"."action" <> 'transition_denied' or nullif(btrim("audit_entry"."denial_reason"), '') is not null) and ("audit_entry"."action" = 'transition_denied' or "audit_entry"."denial_reason" is null) and ("audit_entry"."action" not in ('transition_sent_back', 'line_item_flags_cleared', 'line_item_flags_clear_denied', 'employer_ein_validated') or nullif(btrim("audit_entry"."outcome_reason"), '') is not null));