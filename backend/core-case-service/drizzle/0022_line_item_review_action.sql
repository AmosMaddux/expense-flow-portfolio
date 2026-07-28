ALTER TABLE "gl_coding_result" ADD COLUMN "line_item_review_action" text;
ALTER TABLE "gl_coding_result" ADD COLUMN "line_item_review_reason" text;
ALTER TABLE "gl_coding_result" ADD COLUMN "line_item_reviewed_by" uuid;
ALTER TABLE "gl_coding_result" ADD COLUMN "line_item_reviewed_at" timestamp with time zone;
ALTER TABLE "gl_coding_result" ADD CONSTRAINT "gl_coding_result_line_item_review_check" CHECK (
    ("line_item_review_action" is null and "line_item_review_reason" is null and "line_item_reviewed_by" is null and "line_item_reviewed_at" is null)
    or (
        "source_type" = 'line_item'
        and "line_item_review_action" in ('approve', 'reject')
        and "line_item_reviewed_by" is not null
        and "line_item_reviewed_at" is not null
        and ("line_item_review_action" <> 'reject' or nullif(btrim("line_item_review_reason"), '') is not null)
    )
);
