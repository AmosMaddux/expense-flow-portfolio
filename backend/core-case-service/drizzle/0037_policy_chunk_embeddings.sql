CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "tenant_expense_policy_chunk" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "tenant_expense_policy_chunk" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "tenant_expense_policy_chunk" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tenant_expense_policy_chunk_embedding_idx" ON "tenant_expense_policy_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
ALTER TABLE "tenant_expense_policy_chunk" ADD CONSTRAINT "tenant_expense_policy_chunk_embedding_metadata_check" CHECK (("tenant_expense_policy_chunk"."embedding" is null) = ("tenant_expense_policy_chunk"."embedding_model" is null));