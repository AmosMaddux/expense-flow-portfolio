import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
    boolean,
    check,
    date,
    foreignKey,
    index,
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
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "audit_entry_denial_reason_check",
            sql`(${table.action} <> 'transition_denied' or nullif(btrim(${table.denialReason}), '') is not null) and (${table.action} <> 'transition_approved' or ${table.denialReason} is null)`,
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

export const lineItem = pgTable(
    "line_item",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        merchant: text("merchant").notNull(),
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
        foreignKey({
            name: "line_item_tenant_expense_report_fk",
            // Tenant joins prevent line items from attaching to another tenant's report.
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
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
        index("receipt_metadata_tenant_report_idx").on(
            table.tenantId,
            table.expenseReportId,
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
