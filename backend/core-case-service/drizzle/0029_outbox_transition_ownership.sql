DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "stage_transition_outbox" outbox
        LEFT JOIN "stage_transition" transition
            ON transition."id" = outbox."stage_transition_id"
            AND transition."tenant_id" = outbox."tenant_id"
            AND transition."expense_report_id" = outbox."expense_report_id"
        WHERE transition."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'stage_transition_outbox contains rows whose stage_transition_id, tenant_id, and expense_report_id do not match stage_transition; remediate those rows before applying stage_transition_outbox_transition_tenant_report_fk';
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "stage_transition_tenant_report_id_unique_idx" ON "stage_transition" USING btree ("id","tenant_id","expense_report_id");--> statement-breakpoint
ALTER TABLE "stage_transition_outbox" ADD CONSTRAINT "stage_transition_outbox_transition_tenant_report_fk" FOREIGN KEY ("stage_transition_id","tenant_id","expense_report_id") REFERENCES "public"."stage_transition"("id","tenant_id","expense_report_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "stage_transition_outbox" VALIDATE CONSTRAINT "stage_transition_outbox_transition_tenant_report_fk";
