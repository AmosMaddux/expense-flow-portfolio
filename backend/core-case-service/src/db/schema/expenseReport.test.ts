import { describe, expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

import {
    attachmentMetadata,
    approvedWorkflowStages,
    auditEntry,
    caseComment,
    expenseReport,
    lineItem,
    mileageEntry,
    priorityLevels,
    receiptMetadata,
    stageTransition,
} from "./expenseReport.js";

const requiredExpenseReportColumnNames = [
    "current_stage",
    "on_hold",
    "hold_reason",
    "owner",
    "priority",
    "due_date",
    "tenant_id",
];

const requiredStageTransitionColumnNames = [
    "expense_report_id",
    "tenant_id",
    "from_stage",
    "to_stage",
    "actor",
    "reason",
    "occurred_at",
];

const requiredLineItemColumnNames = [
    "merchant",
    "amount",
    "currency",
    "category",
    "expense_report_id",
    "tenant_id",
];

const caseCommentRequiredColumnNames = [
    "tenant_id",
    "expense_report_id",
    "author_id",
    "body",
    "created_at",
];

const attachmentMetadataRequiredColumnNames = [
    "tenant_id",
    "expense_report_id",
    "filename",
    "content_type",
    "blob_reference",
    "created_at",
];

const receiptMetadataRequiredColumnNames = [
    "expense_report_id",
    "tenant_id",
    "merchant",
    "receipt_date",
    "amount",
    "blob_reference",
];

const mileageEntryRequiredColumnNames = [
    "expense_report_id",
    "tenant_id",
    "route",
    "distance",
    "mileage_date",
];

const auditEntryRequiredColumnNames = [
    "tenant_id",
    "expense_report_id",
    "actor_id",
    "action",
    "stage_before_action",
    "stage_after_proposed_action",
    "created_at",
];

const coreCaseServiceDrizzleUrl = new URL("../../../drizzle/", import.meta.url);
const auditEntryMigrationSqlUrl = new URL(
    "../../../drizzle/0004_fine_rocket_racer.sql",
    import.meta.url,
);

async function readLatestMigrationSql(): Promise<string> {
    // Drizzle chooses a generated suffix, so pin this test to the next migration number.
    const migrationFiles = (await readdir(coreCaseServiceDrizzleUrl))
        .filter((fileName) => /^0005_.*\.sql$/u.test(fileName))
        .sort();

    expect(migrationFiles.length).toBe(1);

    const [migrationFile] = migrationFiles;
    if (migrationFile === undefined) {
        throw new Error("Expected a 0005 migration file");
    }

    return readFile(new URL(migrationFile, coreCaseServiceDrizzleUrl), "utf8");
}

// MUST be strictly equal. If outside, checks FAILED
void describe("expenseReport schema", () => {
    void test("exports the approved workflow stages and priority levels", () => {
        expect(approvedWorkflowStages).toStrictEqual([
            "Drafted",
            "Submitted",
            "Manager Approval",
            "AP Review",
            "Paid",
            "Reconciled",
        ]);

        expect(priorityLevels).toStrictEqual([
            "Low",
            "Normal",
            "High",
            "Urgent",
        ]);
    });

    void test("defines the expense_report table with required case columns", () => {
        const tableConfig = getTableConfig(expenseReport);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(expenseReport)).toEqual("expense_report");
        expect(columnNames.includes("status")).toBeFalsy();

        for (const columnName of requiredExpenseReportColumnNames) {
            expect(columnNames.includes(columnName)).toBeTruthy();
        }

        const tenantId = tableConfig.columns.find(
            (column) => column.name === "tenant_id",
        );

        expect(tenantId).toBeDefined();

        if (tenantId !== undefined) {
            expect(tenantId.notNull).toBeTruthy();
        }
    });

    void test("keeps check constraints and tenant-scoped indexes on the table", () => {
        const tableConfig = getTableConfig(expenseReport);

        expect(
            tableConfig.checks.map((constraint) => constraint.name).sort(),
        ).toEqual([
            "expense_report_current_stage_check",
            "expense_report_hold_reason_check",
            "expense_report_priority_check",
        ]);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "expense_report_tenant_stage_idx",
            "expense_report_tenant_stage_due_date_idx",
            "expense_report_tenant_due_date_idx",
            "expense_report_tenant_owner_idx",
            "expense_report_tenant_priority_idx",
            "expense_report_tenant_id_unique_idx",
        ]);

        const tenantReportIndex = tableConfig.indexes.find(
            (indexConfig) =>
                indexConfig.config.name ===
                "expense_report_tenant_id_unique_idx",
        );

        expect(tenantReportIndex).toBeDefined();

        if (tenantReportIndex !== undefined) {
            expect(tenantReportIndex.config.unique).toBeTruthy();
        }
    });

    void test("generates SQL for the expense_report table, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "expense_report"');
        expect(migrationSql.includes("status")).toBeFalsy();

        for (const columnName of requiredExpenseReportColumnNames) {
            expect(migrationSql).toContain(columnName);
        }
        expect(migrationSql).toContain('"tenant_id" uuid not null');
        expect(migrationSql).toContain("expense_report_current_stage_check");
        expect(migrationSql).toContain('expense_report_priority_check"');
        expect(migrationSql).toContain("expense_report_hold_reason_check");
        expect(migrationSql).toContain("expense_report_tenant_stage_idx");
        expect(migrationSql).toContain(
            "expense_report_tenant_stage_due_date_idx",
        );
        expect(migrationSql).toContain("expense_report_tenant_due_date_idx");
        expect(migrationSql).toContain("expense_report_tenant_owner_idx");
        expect(migrationSql).toContain("expense_report_tenant_priority_idx");
        expect(migrationSql).toContain("expense_report_tenant_id_unique_idx");
    });
});

void describe("auditEntry schema", () => {
    void test("defines the append-only audit_entry table with required event columns", () => {
        const tableConfig = getTableConfig(auditEntry);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(auditEntry)).toEqual("audit_entry");
        expect(columnNames.includes("updated_at")).toBeFalsy();

        for (const columnName of auditEntryRequiredColumnNames) {
            expect(columnNames).toContain(columnName);
        }

        expect(columnNames).toContain("denial_reason");

        for (const columnName of auditEntryRequiredColumnNames) {
            const column = tableConfig.columns.find(
                (tableColumn) => tableColumn.name === columnName,
            );

            expect(column).toBeDefined();

            if (column !== undefined) {
                expect(column.notNull).toBeTruthy();
            }
        }
    });

    void test("keeps audit entries tenant-scoped and queryable by case or actor", () => {
        const tableConfig = getTableConfig(auditEntry);
        const foreignKeys = tableConfig.foreignKeys.map((foreignKeyConfig) => {
            const reference = foreignKeyConfig.reference();

            return {
                columns: reference.columns.map((column) => column.name),
                foreignColumns: reference.foreignColumns.map(
                    (column) => column.name,
                ),
                name: foreignKeyConfig.getName(),
            };
        });

        expect(foreignKeys).toEqual([
            {
                columns: ["tenant_id", "expense_report_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "audit_entry_expense_report_tenant_fk",
            },
        ]);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "audit_entry_tenant_report_created_at_idx",
            "audit_entry_tenant_actor_created_at_idx",
        ]);
    });

    void test("keeps audit event constraints explicit", () => {
        const tableConfig = getTableConfig(auditEntry);

        expect(
            tableConfig.checks.map((constraint) => constraint.name).sort(),
        ).toEqual([
            "audit_entry_denial_reason_check",
            "audit_entry_stage_after_proposed_action_check",
            "audit_entry_stage_before_action_check",
        ]);
    });

    void test("generates SQL for the audit_entry table, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
            receiptMetadata,
            mileageEntry,
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            auditEntry,
            lineItem,
            receiptMetadata,
            mileageEntry,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "audit_entry"');
        expect(migrationSql.includes('"updated_at"')).toBeFalsy();

        for (const columnName of auditEntryRequiredColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain("denial_reason");

        expect(migrationSql).toContain(
            'foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")',
        );
        expect(migrationSql.includes("audit_entry_action_check")).toBeFalsy();
        expect(migrationSql).toContain("audit_entry_denial_reason_check");
        expect(migrationSql).toContain('"action" text not null');
        expect(migrationSql).toContain("transition_approved");
        expect(migrationSql).toContain("transition_denied");
        expect(migrationSql).toContain(
            `"audit_entry"."action" <> 'transition_denied' or nullif(btrim("audit_entry"."denial_reason"), '') is not null`,
        );
        expect(migrationSql).toContain(
            `"audit_entry"."action" <> 'transition_approved' or "audit_entry"."denial_reason" is null`,
        );
        expect(migrationSql).toContain('"stage_before_action" text not null');
        expect(migrationSql).toContain(
            '"stage_after_proposed_action" text not null',
        );
        expect(migrationSql).toContain("audit_entry_stage_before_action_check");
        expect(migrationSql).toContain(
            "audit_entry_stage_after_proposed_action_check",
        );
        expect(migrationSql).toContain(
            "audit_entry_tenant_report_created_at_idx",
        );
        expect(migrationSql).toContain(
            "audit_entry_tenant_actor_created_at_idx",
        );
    });

    void test("keeps hand-authored migration SQL for audit entry immutability", async () => {
        const migrationSql = (
            await readFile(auditEntryMigrationSqlUrl, "utf8")
        ).toLowerCase();

        expect(migrationSql).toContain(
            "create or replace function prevent_audit_entry_mutation()",
        );
        expect(migrationSql).toContain(
            "raise exception 'audit_entry rows are append-only'",
        );
        expect(migrationSql).toContain(
            "create trigger audit_entry_prevent_mutation_trigger",
        );
        expect(migrationSql).toContain(
            'before update or delete on "audit_entry"',
        );
    });
});

void describe("caseComment schema", () => {
    void test("defines the append-only case_comment table with required columns", () => {
        const tableConfig = getTableConfig(caseComment);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(caseComment)).toEqual("case_comment");
        expect(columnNames.includes("updated_at")).toBeFalsy();

        for (const columnName of caseCommentRequiredColumnNames) {
            expect(columnNames).toContain(columnName);

            const column = tableConfig.columns.find(
                (tableColumn) => tableColumn.name === columnName,
            );
            expect(column).toBeDefined();

            if (column !== undefined) {
                expect(column.notNull).toBeTruthy();
            }
        }
    });

    void test("keeps comments tenant-scoped and queryable by report or author", () => {
        const tableConfig = getTableConfig(caseComment);
        const foreignKeys = tableConfig.foreignKeys.map((foreignKeyConfig) => {
            const reference = foreignKeyConfig.reference();

            return {
                columns: reference.columns.map((column) => column.name),
                foreignColumns: reference.foreignColumns.map(
                    (column) => column.name,
                ),
                name: foreignKeyConfig.getName(),
            };
        });

        expect(foreignKeys).toEqual([
            {
                columns: ["tenant_id", "expense_report_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "case_comment_expense_report_tenant_fk",
            },
        ]);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "case_comment_tenant_report_created_at_idx",
            "case_comment_tenant_author_created_at_idx",
        ]);
    });

    void test("keeps comment validation explicit", () => {
        const tableConfig = getTableConfig(caseComment);

        expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
            ["case_comment_body_not_blank_check"],
        );
    });

    void test("generates SQL for comments and the tenant-scoped report foreign key", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
            receiptMetadata,
            mileageEntry,
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
            caseComment,
            receiptMetadata,
            mileageEntry,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "case_comment"');
        expect(migrationSql.includes('"updated_at"')).toBeFalsy();

        for (const columnName of caseCommentRequiredColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain(
            'foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")',
        );
        expect(migrationSql).toContain("case_comment_body_not_blank_check");
        expect(migrationSql).toContain(
            `nullif(btrim("case_comment"."body"), '') is not null`,
        );
        expect(migrationSql).toContain(
            "case_comment_tenant_report_created_at_idx",
        );
        expect(migrationSql).toContain(
            "case_comment_tenant_author_created_at_idx",
        );
    });
});

void describe("attachmentMetadata schema", () => {
    void test("defines the attachment_metadata table with required columns", () => {
        const tableConfig = getTableConfig(attachmentMetadata);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(attachmentMetadata)).toEqual("attachment_metadata");
        expect(columnNames.includes("updated_at")).toBeFalsy();

        for (const columnName of attachmentMetadataRequiredColumnNames) {
            expect(columnNames).toContain(columnName);

            const column = tableConfig.columns.find(
                (tableColumn) => tableColumn.name === columnName,
            );
            expect(column).toBeDefined();

            if (column !== undefined) {
                expect(column.notNull).toBeTruthy();
            }
        }
    });

    void test("keeps attachments tenant-scoped and queryable by report", () => {
        const tableConfig = getTableConfig(attachmentMetadata);
        const foreignKeys = tableConfig.foreignKeys.map((foreignKeyConfig) => {
            const reference = foreignKeyConfig.reference();

            return {
                columns: reference.columns.map((column) => column.name),
                foreignColumns: reference.foreignColumns.map(
                    (column) => column.name,
                ),
                name: foreignKeyConfig.getName(),
            };
        });

        expect(foreignKeys).toEqual([
            {
                columns: ["tenant_id", "expense_report_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "attachment_metadata_expense_report_tenant_fk",
            },
        ]);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual(["attachment_metadata_tenant_report_idx"]);
    });

    void test("keeps attachment validation explicit", () => {
        const tableConfig = getTableConfig(attachmentMetadata);

        expect(
            tableConfig.checks.map((constraint) => constraint.name).sort(),
        ).toEqual([
            "attachment_metadata_content_type_check",
            "attachment_metadata_filename_not_blank_check",
        ]);
    });

    void test("generates SQL for attachments and the MIME type allowlist", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
            receiptMetadata,
            mileageEntry,
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
            attachmentMetadata,
            receiptMetadata,
            mileageEntry,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "attachment_metadata"');
        expect(migrationSql.includes('"updated_at"')).toBeFalsy();

        for (const columnName of attachmentMetadataRequiredColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain('"blob_reference" jsonb not null');
        expect(migrationSql).toContain(
            'foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")',
        );
        expect(migrationSql).toContain(
            "attachment_metadata_filename_not_blank_check",
        );
        expect(migrationSql).toContain(
            "attachment_metadata_content_type_check",
        );
        expect(migrationSql).toContain("'application/pdf'");
        expect(migrationSql).toContain("'image/png'");
        expect(migrationSql).toContain("'image/jpeg'");
        expect(migrationSql).toContain("'image/webp'");
        expect(migrationSql).toContain("'text/plain'");
        expect(migrationSql).toContain("'text/csv'");
        expect(migrationSql).toContain("'application/json'");
        expect(migrationSql).toContain("attachment_metadata_tenant_report_idx");
    });
});

void describe("case comment and attachment migration SQL", () => {
    void test("blocks comment mutation and attachment updates at the database level", async () => {
        const migrationSql = (await readLatestMigrationSql()).toLowerCase();

        expect(migrationSql).toContain(
            "create or replace function prevent_case_comment_mutation()",
        );
        expect(migrationSql).toContain(
            "raise exception 'case_comment rows are append-only'",
        );
        expect(migrationSql).toContain(
            "create trigger case_comment_prevent_mutation_trigger",
        );
        expect(migrationSql).toContain(
            'before update or delete on "case_comment"',
        );

        expect(migrationSql).toContain(
            "create or replace function prevent_attachment_metadata_update()",
        );
        expect(migrationSql).toContain(
            "raise exception 'attachment_metadata rows cannot be updated'",
        );
        expect(migrationSql).toContain(
            "create trigger attachment_metadata_prevent_update_trigger",
        );
        expect(migrationSql).toContain(
            'before update on "attachment_metadata"',
        );
        expect(
            migrationSql.includes(
                'before update or delete on "attachment_metadata"',
            ),
        ).toBeFalsy();
        expect(
            migrationSql.includes('before delete on "attachment_metadata"'),
        ).toBeFalsy();
    });
});

void describe("stageTransition schema", () => {
    void test("defines the stage_transition table with required audit columns", () => {
        const tableConfig = getTableConfig(stageTransition);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(stageTransition)).toEqual("stage_transition");

        for (const columnName of requiredStageTransitionColumnNames) {
            expect(columnNames).toContain(columnName);
        }

        for (const columnName of requiredStageTransitionColumnNames) {
            const column = tableConfig.columns.find(
                (candidate) => candidate.name === columnName,
            );

            expect(column).not.toBeUndefined();

            if (column !== undefined) {
                expect(column.notNull).toBeTruthy();
            }
        }
    });

    void test("keeps workflow checks, reason check, tenant indexes, and tenant-safe foreign key", () => {
        const tableConfig = getTableConfig(stageTransition);

        expect(
            tableConfig.checks.map((constraint) => constraint.name).sort(),
        ).toEqual([
            "stage_transition_from_stage_check",
            "stage_transition_reason_check",
            "stage_transition_to_stage_check",
            "stage_transition_valid_edge_check",
        ]);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "stage_transition_tenant_report_idx",
            "stage_transition_tenant_occurred_at_idx",
        ]);

        const foreignKeys = tableConfig.foreignKeys.map((foreignKeyConfig) => {
            const reference = foreignKeyConfig.reference();

            return {
                columns: reference.columns.map((column) => column.name),
                foreignColumns: reference.foreignColumns.map(
                    (column) => column.name,
                ),
                name: foreignKeyConfig.getName(),
            };
        });

        expect(foreignKeys).toEqual([
            {
                columns: ["tenant_id", "expense_report_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "stage_transition_expense_report_tenant_fk",
            },
        ]);
    });

    void test("documents the valid workflow edge policy", () => {
        const validTransitions = new Set([
            "Drafted->Drafted:report_created",
            "Drafted->Submitted",
            "Submitted->Manager Approval",
            "Manager Approval->AP Review",
            "AP Review->Paid",
            "Paid->Reconciled",
            "Manager Approval->Drafted",
            "AP Review->Drafted",
        ]);
        const isValidTransition = (
            fromStage: (typeof approvedWorkflowStages)[number],
            toStage: (typeof approvedWorkflowStages)[number],
            reason?: string,
        ) => {
            const transitionKey =
                reason === undefined
                    ? `${fromStage}->${toStage}`
                    : `${fromStage}->${toStage}:${reason}`;

            return validTransitions.has(transitionKey);
        };

        expect(
            isValidTransition("Drafted", "Drafted", "report_created"),
        ).toBeTruthy();
        expect(isValidTransition("Drafted", "Submitted")).toBeTruthy();
        expect(isValidTransition("Manager Approval", "AP Review")).toBeTruthy();
        expect(isValidTransition("AP Review", "Paid")).toBeTruthy();
        expect(isValidTransition("Paid", "Reconciled")).toBeTruthy();
        expect(isValidTransition("Manager Approval", "Drafted")).toBeTruthy();
        expect(isValidTransition("AP Review", "Drafted")).toBeTruthy();
        expect(isValidTransition("Paid", "Manager Approval")).toBeFalsy();
        expect(isValidTransition("Submitted", "Drafted")).toBeFalsy();
        expect(isValidTransition("Drafted", "AP Review")).toBeFalsy();
        expect(isValidTransition("Reconciled", "Paid")).toBeFalsy();
        expect(isValidTransition("Reconciled", "Reconciled")).toBeFalsy();
        expect(isValidTransition("Drafted", "Drafted")).toBeFalsy();
        expect(
            isValidTransition("Drafted", "Drafted", "manual_update"),
        ).toBeFalsy();
    });

    void test("generates SQL for the table, constraints, foreign key, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({ expenseReport });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            stageTransition,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "stage_transition"');

        for (const columnName of requiredStageTransitionColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain('"tenant_id" uuid not null');
        expect(migrationSql).toContain(
            '"occurred_at" timestamp with time zone default now() not null',
        );
        expect(migrationSql).toContain("stage_transition_from_stage_check");
        expect(migrationSql).toContain("stage_transition_to_stage_check");
        expect(migrationSql).toContain("stage_transition_reason_check");
        expect(migrationSql).toContain("stage_transition_valid_edge_check");
        expect(migrationSql).toContain("report_created");
        expect(migrationSql).toContain("manager approval");
        expect(migrationSql).toContain("ap review");
        expect(migrationSql).toContain(
            "stage_transition_expense_report_tenant_fk",
        );
        expect(migrationSql).toContain(
            'foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")',
        );
        expect(migrationSql).toContain("stage_transition_tenant_report_idx");
        expect(migrationSql).toContain(
            "stage_transition_tenant_occurred_at_idx",
        );
    });
});

void describe("lineItem schema", () => {
    void test("defines the line_item table with normalized transaction columns", () => {
        const tableConfig = getTableConfig(lineItem);
        const columnNames = tableConfig.columns.map((column) => column.name);

        expect(getTableName(lineItem)).toEqual("line_item");

        for (const columnName of requiredLineItemColumnNames) {
            expect(columnNames).toContain(columnName);
        }

        const tenantId = tableConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const expenseReportId = tableConfig.columns.find(
            (column) => column.name === "expense_report_id",
        );

        expect(tenantId).toBeDefined();
        expect(expenseReportId).toBeDefined();

        if (tenantId !== undefined && expenseReportId !== undefined) {
            expect(tenantId.notNull).toBeTruthy();
            expect(expenseReportId.notNull).toBeTruthy();
        }
    });

    void test("keeps tenant-scoped lookup indexes on line items", () => {
        const tableConfig = getTableConfig(lineItem);

        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual(["line_item_tenant_expense_report_idx"]);
    });

    void test("locks line items to expense reports within the same tenant", () => {
        const tableConfig = getTableConfig(lineItem);
        const foreignKeys = tableConfig.foreignKeys.map((foreignKeyConfig) => {
            const reference = foreignKeyConfig.reference();

            return {
                columns: reference.columns.map((column) => column.name),
                foreignColumns: reference.foreignColumns.map(
                    (column) => column.name,
                ),
                name: foreignKeyConfig.getName(),
            };
        });

        expect(foreignKeys).toEqual([
            {
                columns: ["tenant_id", "expense_report_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "line_item_tenant_expense_report_fk",
            },
        ]);
    });

    void test("generates SQL for the table and expense report foreign key", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({ expenseReport });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            lineItem,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "line_item"');

        for (const columnName of requiredLineItemColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain('"amount" numeric(12, 2) not null');
        expect(migrationSql).toContain('"tenant_id" uuid not null');
        expect(migrationSql).toContain('"expense_report_id" uuid not null');
        expect(migrationSql).toContain(
            'foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")',
        );

        expect(migrationSql).toContain("line_item_tenant_expense_report_idx");
    });
});

void describe("receiptMetadata schema", () => {
    void test("defines the receipt_metadata child table", () => {
        const receiptMetadataConfig = getTableConfig(receiptMetadata);
        const receiptMetadataColumnNames = receiptMetadataConfig.columns.map(
            (column) => column.name,
        );

        expect(getTableName(receiptMetadata)).toEqual("receipt_metadata");

        for (const columnName of receiptMetadataRequiredColumnNames) {
            expect(receiptMetadataColumnNames).toContain(columnName);
        }

        const receiptMetadataTenantId = receiptMetadataConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const receiptMetadataExpenseReportId =
            receiptMetadataConfig.columns.find(
                (column) => column.name === "expense_report_id",
            );

        expect(receiptMetadataTenantId).toBeDefined();
        expect(receiptMetadataExpenseReportId).toBeDefined();

        if (
            receiptMetadataTenantId !== undefined &&
            receiptMetadataExpenseReportId !== undefined
        ) {
            expect(receiptMetadataTenantId.notNull).toBeTruthy();
            expect(receiptMetadataExpenseReportId.notNull).toBeTruthy();
        }

        expect(
            receiptMetadataConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
        ).toEqual(["receipt_metadata_expense_report_tenant_fk"]);

        expect(
            receiptMetadataConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
        ).toEqual(["receipt_metadata_tenant_report_idx"]);
    });

    void test("generates SQL for the receipt_metadata table, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({ expenseReport });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            receiptMetadata,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "receipt_metadata"');

        for (const columnName of receiptMetadataRequiredColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain('"amount" numeric(12, 2) not null');
        expect(migrationSql).toContain('"blob_reference" jsonb not null');

        expect(migrationSql).toMatch(
            /"receipt_metadata".*"tenant_id" uuid not null/s,
        );
        expect(migrationSql).toMatch(
            /"receipt_metadata".*"expense_report_id" uuid not null/s,
        );

        expect(migrationSql).toContain(
            "receipt_metadata_expense_report_tenant_fk",
        );
        expect(migrationSql).toContain("receipt_metadata_tenant_report_idx");
    });
});

void describe("mileageEntry schema", () => {
    void test("defines the mileage_entry child table", () => {
        const mileageEntryConfig = getTableConfig(mileageEntry);
        const mileageEntryColumnNames = mileageEntryConfig.columns.map(
            (column) => column.name,
        );

        expect(getTableName(mileageEntry)).toEqual("mileage_entry");

        for (const columnName of mileageEntryRequiredColumnNames) {
            expect(mileageEntryColumnNames).toContain(columnName);
        }

        const mileageEntryTenantId = mileageEntryConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const mileageEntryExpenseReportId = mileageEntryConfig.columns.find(
            (column) => column.name === "expense_report_id",
        );

        expect(mileageEntryTenantId).toBeDefined();
        expect(mileageEntryExpenseReportId).toBeDefined();

        if (
            mileageEntryTenantId !== undefined &&
            mileageEntryExpenseReportId !== undefined
        ) {
            expect(mileageEntryTenantId.notNull).toBeTruthy();
            expect(mileageEntryExpenseReportId.notNull).toBeTruthy();
        }

        expect(
            mileageEntryConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
        ).toEqual(["mileage_entry_expense_report_tenant_fk"]);

        expect(
            mileageEntryConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
        ).toEqual(["mileage_entry_tenant_report_idx"]);
    });

    void test("generates SQL for the mileage_entry table, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({ expenseReport });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            mileageEntry,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        expect(migrationSql).toContain('create table "mileage_entry"');

        for (const columnName of mileageEntryRequiredColumnNames) {
            expect(migrationSql).toContain(columnName);
        }

        expect(migrationSql).toContain('"distance" numeric(8, 2) not null');

        expect(migrationSql).toMatch(
            /"mileage_entry".*"tenant_id" uuid not null/s,
        );
        expect(migrationSql).toMatch(
            /"mileage_entry".*"expense_report_id" uuid not null/s,
        );

        expect(migrationSql).toContain(
            "mileage_entry_expense_report_tenant_fk",
        );
        expect(migrationSql).toContain("mileage_entry_tenant_report_idx");
    });
});
