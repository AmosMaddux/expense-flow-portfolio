CREATE INDEX "line_item_tenant_created_id_idx" ON "line_item" USING btree ("tenant_id","created_at" DESC,"id" ASC);
CREATE INDEX "line_item_tenant_category_created_id_idx" ON "line_item" USING btree ("tenant_id","category","created_at" DESC,"id" ASC);
