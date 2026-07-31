ALTER TABLE "gl_coding_result" DROP CONSTRAINT "gl_coding_result_line_item_review_check";

ALTER TABLE "gl_coding_result" ADD CONSTRAINT "gl_coding_result_line_item_review_check" CHECK (
    ("line_item_review_action" is null and "line_item_review_reason" is null and "line_item_reviewed_by" is null and "line_item_reviewed_at" is null)
    or (
        "source_type" in ('line_item', 'mileage')
        and "line_item_review_action" in ('approve', 'reject')
        and "line_item_reviewed_by" is not null
        and "line_item_reviewed_at" is not null
        and ("line_item_review_action" <> 'reject' or nullif(btrim("line_item_review_reason"), '') is not null)
    )
);
