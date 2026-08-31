CREATE INDEX CONCURRENTLY IF NOT EXISTS "reference_data_audit_entry_created_at_id_idx" ON "reference_data_audit_entry" USING btree ("created_at" DESC,"id" DESC);
