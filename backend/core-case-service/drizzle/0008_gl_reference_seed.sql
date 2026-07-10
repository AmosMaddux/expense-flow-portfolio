CREATE TABLE "gl_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_code_account_code_not_blank_check" CHECK (nullif(btrim("gl_code"."account_code"), '') is not null),
	CONSTRAINT "gl_code_account_name_not_blank_check" CHECK (nullif(btrim("gl_code"."account_name"), '') is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gl_code_tenant_account_code_unique_idx" ON "gl_code" USING btree ("tenant_id","account_code");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_code_tenant_id_unique_idx" ON "gl_code" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE TABLE "gl_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"gl_code_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_mapping_category_not_blank_check" CHECK (nullif(btrim("gl_mapping"."category"), '') is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gl_mapping_tenant_category_unique_idx" ON "gl_mapping" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "gl_mapping_tenant_gl_code_idx" ON "gl_mapping" USING btree ("tenant_id","gl_code_id");--> statement-breakpoint
ALTER TABLE "gl_mapping" ADD CONSTRAINT "gl_mapping_gl_code_tenant_fk" FOREIGN KEY ("tenant_id","gl_code_id") REFERENCES "public"."gl_code"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "gl_code" ("id", "tenant_id", "account_code", "account_name", "description")
VALUES
	('10000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000300', '6000', 'Travel Expense', 'Baseline travel expense account'),
	('10000000-0000-4000-8000-000000000902', '40000000-0000-4000-8000-000000000300', '6100', 'Meals Expense', 'Baseline meals expense account'),
	('10000000-0000-4000-8000-000000000903', '40000000-0000-4000-8000-000000000300', '6200', 'Lodging Expense', 'Baseline lodging expense account'),
	('10000000-0000-4000-8000-000000000904', '40000000-0000-4000-8000-000000000300', '6300', 'Mileage Expense', 'Baseline mileage expense account'),
	('10000000-0000-4000-8000-000000000905', '40000000-0000-4000-8000-000000000300', '6400', 'Office Supplies Expense', 'Baseline office supplies expense account'),
	('10000000-0000-4000-8000-000000000906', '40000000-0000-4000-8000-000000000300', '6500', 'Software Expense', 'Baseline software expense account'),
	('10000000-0000-4000-8000-000000000907', '40000000-0000-4000-8000-000000000300', '6999', 'Other Expense', 'Baseline uncategorized expense account')
ON CONFLICT ("tenant_id", "account_code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "gl_mapping" ("id", "tenant_id", "category", "gl_code_id")
VALUES
	('20000000-0000-4000-8000-000000000901', '40000000-0000-4000-8000-000000000300', 'Travel', '10000000-0000-4000-8000-000000000901'),
	('20000000-0000-4000-8000-000000000902', '40000000-0000-4000-8000-000000000300', 'Meals', '10000000-0000-4000-8000-000000000902'),
	('20000000-0000-4000-8000-000000000903', '40000000-0000-4000-8000-000000000300', 'Lodging', '10000000-0000-4000-8000-000000000903'),
	('20000000-0000-4000-8000-000000000904', '40000000-0000-4000-8000-000000000300', 'Mileage', '10000000-0000-4000-8000-000000000904'),
	('20000000-0000-4000-8000-000000000905', '40000000-0000-4000-8000-000000000300', 'Office Supplies', '10000000-0000-4000-8000-000000000905'),
	('20000000-0000-4000-8000-000000000906', '40000000-0000-4000-8000-000000000300', 'Software', '10000000-0000-4000-8000-000000000906'),
	('20000000-0000-4000-8000-000000000907', '40000000-0000-4000-8000-000000000300', 'Other', '10000000-0000-4000-8000-000000000907')
ON CONFLICT ("tenant_id", "category") DO NOTHING;