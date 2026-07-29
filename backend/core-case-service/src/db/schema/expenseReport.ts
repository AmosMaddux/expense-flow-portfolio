import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
    bigserial,
    boolean,
    check,
    date,
    foreignKey,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

export const approvedWorkflowStages = [
    "Drafted",
    "Submitted",
    "Manager Approval",
    "AP Review",
    "Paid",
    "Reconciled",
] as const;

export const priorityLevels = ["Low", "Normal", "High", "Urgent"] as const;

export const approvedAttachmentContentTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "text/csv",
    "application/json",
] as const;

export const glCodingSourceTypes = ["line_item", "mileage"] as const;
export const lineItemReviewActions = ["approve", "reject"] as const;

function buildStaticStringInListSql(values: readonly string[]) {
    if (values.length === 0) {
        throw new Error(
            "Static SQL allowlists must contain at least one value.",
        );
    }

    // sql.raw preserves literal migration SQL; use only with hard-coded schema allowlists.
    return sql.join(
        values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`)),
        sql`, `,
    );
}

const approvedWorkflowStageCheckSql = buildStaticStringInListSql(
    approvedWorkflowStages,
);
const priorityLevelCheckSql = buildStaticStringInListSql(priorityLevels);
const approvedAttachmentContentTypeCheckSql = buildStaticStringInListSql(
    approvedAttachmentContentTypes,
);
const glCodingSourceTypeCheckSql =
    buildStaticStringInListSql(glCodingSourceTypes);
const lineItemReviewActionCheckSql = buildStaticStringInListSql(
    lineItemReviewActions,
);

export const expenseReport = pgTable(
    "expense_report",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        currentStage: text("current_stage").notNull().default("Drafted"),
        onHold: boolean("on_hold").notNull().default(false),
        holdReason: text("hold_reason"),
        owner: uuid("owner").notNull(),
        priority: text("priority").notNull().default("Normal"),
        dueDate: date("due_date").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "expense_report_current_stage_check",
            sql`${table.currentStage} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "expense_report_priority_check",
            sql`${table.priority} in (${priorityLevelCheckSql})`,
        ),
        check(
            "expense_report_hold_reason_check",
            sql`(${table.onHold} = true and nullif(btrim(${table.holdReason}), '') is not null) or (${table.onHold} = false and ${table.holdReason} is null)`,
        ),
        index("expense_report_tenant_stage_idx").on(
            table.tenantId,
            table.currentStage,
        ),
        index("expense_report_tenant_stage_due_date_idx").on(
            table.tenantId,
            table.currentStage,
            table.dueDate,
        ),
        index("expense_report_tenant_due_date_idx").on(
            table.tenantId,
            table.dueDate,
        ),
        index("expense_report_tenant_owner_idx").on(
            table.tenantId,
            table.owner,
        ),
        index("expense_report_tenant_priority_idx").on(
            table.tenantId,
            table.priority,
        ),
        // Child tables use this key so their tenant_id must match the parent report.
        uniqueIndex("expense_report_tenant_id_unique_idx").on(
            table.tenantId,
            table.id,
        ),
    ],
);

export type ExpenseReport = InferSelectModel<typeof expenseReport>;
export type NewExpenseReport = InferInsertModel<typeof expenseReport>;

export const auditEntry = pgTable(
    "audit_entry",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sequence: bigserial("sequence", { mode: "number" }),
        tenantId: uuid("tenant_id").notNull(),
        expenseReportId: uuid("expense_report_id").notNull(),
        actorId: uuid("actor_id").notNull(),
        // Action is intentionally text for now because future audit events are not fully enumerated yet.
        // Known initial values include transition_approved and transition_denied.
        // Future stories such as SCRUM-108 may add more state-changing action names.
        action: text("action").notNull(),
        stageBeforeAction: text("stage_before_action").notNull(),
        stageAfterProposedAction: text("stage_after_proposed_action").notNull(),
        denialReason: text("denial_reason"),
        outcomeReason: text("outcome_reason"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "audit_entry_denial_reason_check",
            sql`(${table.action} <> 'transition_denied' or nullif(btrim(${table.denialReason}), '') is not null) and (${table.action} = 'transition_denied' or ${table.denialReason} is null) and (${table.action} not in ('transition_sent_back', 'line_item_flags_cleared', 'line_item_flags_clear_denied') or nullif(btrim(${table.outcomeReason}), '') is not null)`,
        ),
        check(
            "audit_entry_stage_before_action_check",
            sql`${table.stageBeforeAction} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "audit_entry_stage_after_proposed_action_check",
            sql`${table.stageAfterProposedAction} in (${approvedWorkflowStageCheckSql})`,
        ),
        index("audit_entry_tenant_report_created_at_idx").on(
            table.tenantId,
            table.expenseReportId,
            table.createdAt,
        ),
        index("audit_entry_tenant_report_sequence_idx").on(
            table.tenantId,
            table.expenseReportId,
            table.sequence,
        ),
        index("audit_entry_tenant_actor_created_at_idx").on(
            table.tenantId,
            table.actorId,
            table.createdAt,
        ),
        foreignKey({
            name: "audit_entry_expense_report_tenant_fk",
            // Tenant joins prevent audit entries from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
    ],
);

export const stageTransition = pgTable(
    "stage_transition",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        expenseReportId: uuid("expense_report_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        fromStage: text("from_stage").notNull(),
        toStage: text("to_stage").notNull(),
        actor: uuid("actor").notNull(),
        reason: text("reason").notNull(),
        occurredAt: timestamp("occurred_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "stage_transition_from_stage_check",
            sql`${table.fromStage} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "stage_transition_to_stage_check",
            sql`${table.toStage} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "stage_transition_reason_check",
            sql`nullif(btrim(${table.reason}), '') is not null`,
        ),
        check(
            "stage_transition_valid_edge_check",
            sql`(
                (${table.fromStage} = 'Drafted' and ${table.toStage} = 'Drafted' and ${table.reason} = 'report_created')
                or (${table.fromStage} = 'Drafted' and ${table.toStage} = 'Submitted')
                or (${table.fromStage} = 'Submitted' and ${table.toStage} = 'Manager Approval')
                or (${table.fromStage} = 'Manager Approval' and ${table.toStage} = 'AP Review')
                or (${table.fromStage} = 'AP Review' and ${table.toStage} = 'Paid')
                or (${table.fromStage} = 'Paid' and ${table.toStage} = 'Reconciled')
                or (${table.fromStage} = 'Manager Approval' and ${table.toStage} = 'Drafted')
                or (${table.fromStage} = 'AP Review' and ${table.toStage} = 'Drafted')
                or (${table.fromStage} = ${table.toStage} and ${table.reason} like 'transition_denied:%')
            )`,
        ),
        foreignKey({
            name: "stage_transition_expense_report_tenant_fk",
            // Tenant joins prevent transitions from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        index("stage_transition_tenant_report_idx").on(
            table.tenantId,
            table.expenseReportId,
        ),
        index("stage_transition_tenant_occurred_at_idx").on(
            table.tenantId,
            table.occurredAt,
        ),
    ],
);

export type StageTransition = InferSelectModel<typeof stageTransition>;
export type NewStageTransition = InferInsertModel<typeof stageTransition>;

export const stageTransitionOutbox = pgTable(
    "stage_transition_outbox",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        stageTransitionId: uuid("stage_transition_id")
            .notNull()
            .references(() => stageTransition.id),
        expenseReportId: uuid("expense_report_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        correlationId: uuid("correlation_id").notNull(),
        idempotencyKey: text("idempotency_key"),
        fromStage: text("from_stage").notNull(),
        toStage: text("to_stage").notNull(),
        occurredAt: timestamp("occurred_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        attemptCount: integer("attempt_count").notNull().default(0),
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        lockedUntil: timestamp("locked_until", { withTimezone: true }),
        lockId: uuid("lock_id"),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    },
    (table) => [
        check(
            "stage_transition_outbox_from_stage_check",
            sql`${table.fromStage} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "stage_transition_outbox_to_stage_check",
            sql`${table.toStage} in (${approvedWorkflowStageCheckSql})`,
        ),
        check(
            "stage_transition_outbox_changed_stage_check",
            sql`${table.fromStage} <> ${table.toStage}`,
        ),
        check(
            "stage_transition_outbox_attempt_count_check",
            sql`${table.attemptCount} >= 0`,
        ),
        check(
            "stage_transition_outbox_lock_check",
            sql`(${table.lockId} is null and ${table.lockedUntil} is null) or (${table.lockId} is not null and ${table.lockedUntil} is not null)`,
        ),
        foreignKey({
            name: "stage_transition_outbox_expense_report_tenant_fk",
            // Tenant-scoped ownership prevents an outbox event from identifying another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        uniqueIndex("stage_transition_outbox_transition_unique_idx").on(
            table.stageTransitionId,
        ),
        index("stage_transition_outbox_submission_idempotency_idx").on(
            table.tenantId,
            table.expenseReportId,
            table.idempotencyKey,
        ),
        index("stage_transition_outbox_dispatch_idx").on(
            table.publishedAt,
            table.deadLetteredAt,
            table.nextAttemptAt,
            table.lockedUntil,
        ),
    ],
);

export type StageTransitionOutbox = InferSelectModel<
    typeof stageTransitionOutbox
>;
export type NewStageTransitionOutbox = InferInsertModel<
    typeof stageTransitionOutbox
>;

export const lineItem = pgTable(
    "line_item",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        merchant: text("merchant").notNull(),
        expenseDate: date("expense_date").notNull(),
        amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
        currency: text("currency").notNull(),
        category: text("category").notNull(),
        expenseReportId: uuid("expense_report_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index("line_item_tenant_expense_report_idx").on(
            table.tenantId,
            table.expenseReportId,
        ),
        index("line_item_tenant_expense_date_id_idx").on(
            table.tenantId,
            table.expenseDate.desc(),
            table.id.asc(),
        ),
        index("line_item_tenant_category_expense_date_id_idx").on(
            table.tenantId,
            table.category,
            table.expenseDate.desc(),
            table.id.asc(),
        ),
        // Receipt metadata uses this composite key to enforce tenant ownership.
        uniqueIndex("line_item_tenant_id_unique_idx").on(
            table.tenantId,
            table.id,
        ),
        foreignKey({
            name: "line_item_tenant_expense_report_fk",
            // Tenant joins prevent line items from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
    ],
);

export const glCode = pgTable(
    "gl_code",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        accountCode: text("account_code").notNull(),
        accountName: text("account_name").notNull(),
        description: text("description"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "gl_code_account_code_not_blank_check",
            sql`nullif(btrim(${table.accountCode}), '') is not null`,
        ),
        check(
            "gl_code_account_name_not_blank_check",
            sql`nullif(btrim(${table.accountName}), '') is not null`,
        ),
        uniqueIndex("gl_code_tenant_account_code_unique_idx").on(
            table.tenantId,
            table.accountCode,
        ),
        // Mapping rows use this key so their tenant_id must match the referenced GL code.
        uniqueIndex("gl_code_tenant_id_unique_idx").on(
            table.tenantId,
            table.id,
        ),
    ],
);

export const glMapping = pgTable(
    "gl_mapping",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        category: text("category").notNull(),
        glCodeId: uuid("gl_code_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "gl_mapping_category_not_blank_check",
            sql`nullif(btrim(${table.category}), '') is not null`,
        ),
        uniqueIndex("gl_mapping_tenant_category_unique_idx").on(
            table.tenantId,
            table.category,
        ),
        index("gl_mapping_tenant_gl_code_idx").on(
            table.tenantId,
            table.glCodeId,
        ),
        foreignKey({
            name: "gl_mapping_gl_code_tenant_fk",
            // Tenant joins prevent category mappings from pointing to another tenant's GL code.
            columns: [table.tenantId, table.glCodeId],
            foreignColumns: [glCode.tenantId, glCode.id],
        }),
    ],
);

export const glCodingResult = pgTable(
    "gl_coding_result",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        submissionId: uuid("submission_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        expenseReportId: uuid("expense_report_id").notNull(),
        sourceType: text("source_type").notNull(),
        sourceId: uuid("source_id").notNull(),
        category: text("category").notNull(),
        mappingStatus: text("mapping_status").notNull(),
        glAccountCode: text("gl_account_code"),
        glAccountName: text("gl_account_name"),
        amount: numeric("amount", { precision: 12, scale: 2 }),
        currency: text("currency"),
        flaggedLineItem: boolean("flagged_line_item").notNull().default(false),
        flagCode: text("flag_code"),
        flagMessage: text("flag_message"),
        deductible: boolean("deductible").notNull().default(false),
        lineItemReviewAction: text("line_item_review_action"),
        lineItemReviewReason: text("line_item_review_reason"),
        lineItemReviewedBy: uuid("line_item_reviewed_by"),
        lineItemReviewedAt: timestamp("line_item_reviewed_at", {
            withTimezone: true,
        }),
        codedAt: timestamp("coded_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "gl_coding_result_source_type_check",
            sql`${table.sourceType} in (${glCodingSourceTypeCheckSql})`,
        ),
        check(
            "gl_coding_result_mapping_status_check",
            sql`${table.mappingStatus} in ('mapped', 'unmapped')`,
        ),
        check(
            "gl_coding_result_line_item_review_check",
            sql`(${table.lineItemReviewAction} is null and ${table.lineItemReviewReason} is null and ${table.lineItemReviewedBy} is null and ${table.lineItemReviewedAt} is null) or (${table.sourceType} in ('line_item', 'mileage') and ${table.lineItemReviewAction} in (${lineItemReviewActionCheckSql}) and ${table.lineItemReviewedBy} is not null and ${table.lineItemReviewedAt} is not null and (${table.lineItemReviewAction} <> 'reject' or nullif(btrim(${table.lineItemReviewReason}), '') is not null))`,
        ),
        foreignKey({
            name: "gl_coding_result_expense_report_tenant_fk",
            // Tenant joins prevent coding history from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        index("gl_coding_result_tenant_source_coded_at_idx").on(
            table.tenantId,
            table.sourceType,
            table.sourceId,
            table.codedAt,
            table.id,
        ),
        index("gl_coding_result_tenant_submission_idx").on(
            table.tenantId,
            table.submissionId,
        ),
    ],
);
export const caseComment = pgTable(
    "case_comment",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        expenseReportId: uuid("expense_report_id").notNull(),
        authorId: uuid("author_id").notNull(),
        body: text("body").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "case_comment_body_not_blank_check",
            sql`nullif(btrim(${table.body}), '') is not null`,
        ),
        foreignKey({
            name: "case_comment_expense_report_tenant_fk",
            // Tenant joins prevent comments from attaching to another tenant's case.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        index("case_comment_tenant_report_created_at_idx").on(
            table.tenantId,
            table.expenseReportId,
            table.createdAt,
        ),
        index("case_comment_tenant_author_created_at_idx").on(
            table.tenantId,
            table.authorId,
            table.createdAt,
        ),
    ],
);

export const attachmentMetadata = pgTable(
    "attachment_metadata",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        expenseReportId: uuid("expense_report_id").notNull(),
        filename: text("filename").notNull(),
        contentType: text("content_type").notNull(),
        // Store only object metadata here; attachment bytes stay in blob storage.
        blobReference: jsonb("blob_reference").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "attachment_metadata_filename_not_blank_check",
            sql`nullif(btrim(${table.filename}), '') is not null`,
        ),
        check(
            "attachment_metadata_content_type_check",
            // Canonical MIME types keep attachment handling predictable downstream.
            sql`${table.contentType} in (${approvedAttachmentContentTypeCheckSql})`,
        ),
        foreignKey({
            name: "attachment_metadata_expense_report_tenant_fk",
            // Tenant joins prevent artifacts from attaching to another tenant's case.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        index("attachment_metadata_tenant_report_idx").on(
            table.tenantId,
            table.expenseReportId,
        ),
    ],
);

export const receiptMetadata = pgTable(
    "receipt_metadata",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        expenseReportId: uuid("expense_report_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        // Nullable only for receipt metadata created before line-item links existed.
        lineItemId: uuid("line_item_id"),
        merchant: text("merchant").notNull(),
        receiptDate: date("receipt_date").notNull(),
        amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
        // Receipt storage needs structured blob metadata, not receipt binary content.
        blobReference: jsonb("blob_reference").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        foreignKey({
            name: "receipt_metadata_expense_report_tenant_fk",
            // Tenant joins prevent receipt metadata from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        foreignKey({
            name: "receipt_metadata_line_item_tenant_fk",
            // The authenticated tenant must own both the receipt and its line item.
            columns: [table.tenantId, table.lineItemId],
            foreignColumns: [lineItem.tenantId, lineItem.id],
        }),
        index("receipt_metadata_tenant_report_idx").on(
            table.tenantId,
            table.expenseReportId,
        ),
        index("receipt_metadata_tenant_line_item_idx").on(
            table.tenantId,
            table.lineItemId,
        ),
    ],
);

export const mileageEntry = pgTable(
    "mileage_entry",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        expenseReportId: uuid("expense_report_id").notNull(),
        tenantId: uuid("tenant_id").notNull(),
        route: text("route").notNull(),
        distance: numeric("distance", { precision: 8, scale: 2 }).notNull(),
        mileageDate: date("mileage_date").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        foreignKey({
            name: "mileage_entry_expense_report_tenant_fk",
            // Tenant joins prevent mileage entries from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
        index("mileage_entry_tenant_report_idx").on(
            table.tenantId,
            table.expenseReportId,
        ),
    ],
);

export type LineItem = InferSelectModel<typeof lineItem>;
export type NewLineItem = InferInsertModel<typeof lineItem>;
export type GlCode = InferSelectModel<typeof glCode>;
export type NewGlCode = InferInsertModel<typeof glCode>;
export type GlMapping = InferSelectModel<typeof glMapping>;
export type NewGlMapping = InferInsertModel<typeof glMapping>;
export type GlCodingResult = InferSelectModel<typeof glCodingResult>;
export type NewGlCodingResult = InferInsertModel<typeof glCodingResult>;
export type CaseComment = InferSelectModel<typeof caseComment>;
export type NewCaseComment = InferInsertModel<typeof caseComment>;
export type AttachmentMetadata = InferSelectModel<typeof attachmentMetadata>;
export type NewAttachmentMetadata = InferInsertModel<typeof attachmentMetadata>;
export type ReceiptMetadata = InferSelectModel<typeof receiptMetadata>;
export type NewReceiptMetadata = InferInsertModel<typeof receiptMetadata>;
export type MileageEntry = InferSelectModel<typeof mileageEntry>;
export type NewMileageEntry = InferInsertModel<typeof mileageEntry>;
export type AuditEntry = InferSelectModel<typeof auditEntry>;
export type NewAuditEntry = InferInsertModel<typeof auditEntry>;
