ALTER TABLE "receipt_metadata" ADD COLUMN "line_item_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "line_item_tenant_id_unique_idx" ON "line_item" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "receipt_metadata" ADD CONSTRAINT "receipt_metadata_line_item_tenant_fk" FOREIGN KEY ("tenant_id","line_item_id") REFERENCES "public"."line_item"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_metadata_tenant_line_item_idx" ON "receipt_metadata" USING btree ("tenant_id","line_item_id");
