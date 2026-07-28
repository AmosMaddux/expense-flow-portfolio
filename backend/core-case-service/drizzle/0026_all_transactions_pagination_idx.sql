CREATE INDEX CONCURRENTLY IF NOT EXISTS "line_item_tenant_expense_date_id_idx" ON "line_item" USING btree ("tenant_id","expense_date" DESC,"id" ASC);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "line_item_tenant_category_expense_date_id_idx" ON "line_item" USING btree ("tenant_id","category","expense_date" DESC,"id" ASC);
