import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
    boolean,
    check,
    date,
    foreignKey,
    index,
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
            sql`${table.currentStage} in ('Drafted', 'Submitted', 'Manager Approval', 'AP Review', 'Paid', 'Reconciled')`,
        ),
        check(
            "expense_report_priority_check",
            sql`${table.priority} in ('Low', 'Normal', 'High', 'Urgent')`,
        ),
        check(
            "expense_report_hold_reason_check",
            sql`(${table.onHold} = true and nullif(btrim(${table.holdReason}), '') is not null) or (${table.onHold} = false and ${table.holdReason} is null)`,
        ),
        index("expense_report_tenant_stage_idx").on(
            table.tenantId,
            table.currentStage,
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
        uniqueIndex("expense_report_tenant_id_unique_idx").on(
            table.tenantId,
            table.id,
        ),
    ],
);

export type ExpenseReport = InferSelectModel<typeof expenseReport>;
export type NewExpenseReport = InferInsertModel<typeof expenseReport>;

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
            columns: [table.tenantId, table.expenseReportId],
            foreignColumns: [expenseReport.tenantId, expenseReport.id],
        }),
    ],
);

export type LineItem = InferSelectModel<typeof lineItem>;
export type NewLineItem = InferInsertModel<typeof lineItem>;
