ALTER TABLE "alert_disposition" ALTER COLUMN "resolved_at" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "alert_disposition" ALTER COLUMN "resolved_at" DROP NOT NULL;
--> statement-breakpoint
UPDATE "alert_disposition"
SET "resolved_at" = NULL
WHERE "status" <> 'resolved';
--> statement-breakpoint
ALTER TABLE "alert_disposition"
ADD CONSTRAINT "alert_disposition_resolved_at_status_check" CHECK (("status" = 'resolved' AND "resolved_at" IS NOT NULL) OR ("status" <> 'resolved' AND "resolved_at" IS NULL));
