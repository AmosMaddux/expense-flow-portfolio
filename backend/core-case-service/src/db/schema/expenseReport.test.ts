// import { describe, test } from "node:test";
import { describe, expect, test } from "vitest";
// import assert from "node:assert/strict";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

import {
    approvedWorkflowStages,
    expenseReport,
    lineItem,
    mileageEntry,
    priorityLevels,
    receiptMetadata,
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

const requiredLineItemColumnNames = [
    "merchant",
    "amount",
    "currency",
    "category",
    "expense_report_id",
    "tenant_id",
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

        expect(priorityLevels).toStrictEqual(["Low", "Normal", "High", "Urgent"]);
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

        expect(tenantId).not.toBeUndefined();

        if (tenantId !== undefined) {
            expect(tenantId.notNull).toBeTruthy();
        }

    });

    void test("keeps check constraints and tenant-scoped indexes on the table", () => {
        const tableConfig = getTableConfig(expenseReport);

        expect(tableConfig.checks.map((constraint) => constraint.name).sort()).toEqual([
                "expense_report_current_stage_check",
                "expense_report_hold_reason_check",
                "expense_report_priority_check",
            ]);

        expect(tableConfig.indexes.map((indexConfig) => indexConfig.config.name)).toEqual([
                "expense_report_tenant_stage_idx",
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

        expect(tenantReportIndex).not.toBeUndefined();

        if (tenantReportIndex !== undefined) {
            expect(tenantReportIndex).toBeTruthy();
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
        // assert.match(migrationSql, /create table "expense_report"/);
        expect(migrationSql).not.toContain('status');

        // assert.doesNotMatch(migrationSql, /\bstatus\b/);

        for (const columnName of requiredExpenseReportColumnNames) {
            expect(migrationSql).toContain(columnName);
            // assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }
        expect(migrationSql).toContain('"tenant_id" uuid not null');
        expect(migrationSql).toContain('expense_report_current_stage_check');
        expect(migrationSql).toContain('expense_report_priority_check"');
        expect(migrationSql).toContain('expense_report_hold_reason_check');
        expect(migrationSql).toContain('expense_report_tenant_stage_idx');
        expect(migrationSql).toContain('expense_report_tenant_due_date_idx');
        expect(migrationSql).toContain('expense_report_tenant_owner_idx');
        expect(migrationSql).toContain('expense_report_tenant_priority_idx');
        expect(migrationSql).toContain('expense_report_tenant_id_unique_idx');

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

        expect(tenantId).not.toBeUndefined();
        expect(expenseReportId).not.toBeUndefined();

        if (tenantId !== undefined && expenseReportId !== undefined) {
            expect(tenantId.notNull).toBeTruthy();
            expect(expenseReportId.notNull).toBeTruthy();
        }
    });

    void test("keeps tenant-scoped lookup indexes on line items", () => {
        const tableConfig = getTableConfig(lineItem);

        expect(tableConfig.indexes.map((indexConfig) => indexConfig.config.name)).toEqual(["line_item_tenant_expense_report_idx"]);

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

        expect(foreignKeys).toEqual(
            [
                {
                    columns: ["tenant_id", "expense_report_id"],
                    foreignColumns: ["tenant_id", "id"],
                    name: "line_item_tenant_expense_report_fk",
                },
            ]
        );
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
        expect(migrationSql).toContain('foreign key ("tenant_id","expense_report_id") references "public"."expense_report"("tenant_id","id")');

        expect(migrationSql).toContain('line_item_tenant_expense_report_idx');
    });
});

void describe("receiptMetadata schema", () => {
    void test("defines the receipt_metadata child table", () => {
        const receiptMetadataConfig = getTableConfig(receiptMetadata);
        const receiptMetadataColumnNames = receiptMetadataConfig.columns.map(
            (column) => column.name,
        );

        expect(getTableName(receiptMetadata)).toEqual("receipt_metadata")

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

        expect(receiptMetadataTenantId).not.toBeUndefined();
        expect(receiptMetadataExpenseReportId).not.toBeUndefined();

        if (
            receiptMetadataTenantId !== undefined &&
            receiptMetadataExpenseReportId !== undefined
        ) {
            expect(receiptMetadataTenantId.notNull).toBeTruthy();
            expect(receiptMetadataExpenseReportId.notNull).toBeTruthy();
        }

        expect(receiptMetadataConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            )).toEqual(["receipt_metadata_expense_report_tenant_fk"]);
        
        expect(receiptMetadataConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            )).toEqual(["receipt_metadata_tenant_report_idx"]);

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

        expect(migrationSql).toContain('create table "receipt_metadata"')

        for (const columnName of receiptMetadataRequiredColumnNames) {
            expect(migrationSql).toContain(columnName)

        }

        expect(migrationSql).toContain('"amount" numeric(12, 2) not null')
        expect(migrationSql).toContain('"blob_reference" jsonb not null')

        expect(migrationSql).toMatch(/"receipt_metadata".*"tenant_id" uuid not null/s)
        expect(migrationSql).toMatch(/"receipt_metadata".*"tenant_id" uuid not null/s)


        expect(migrationSql).toContain('receipt_metadata_expense_report_tenant_fk')
        expect(migrationSql).toContain('receipt_metadata_tenant_report_idx')

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

        expect(mileageEntryTenantId).not.toBeUndefined();
        expect(mileageEntryExpenseReportId).not.toBeUndefined();

        if (
            mileageEntryTenantId !== undefined &&
            mileageEntryExpenseReportId !== undefined
        ) {
            expect(mileageEntryTenantId.notNull).toBeTruthy();
            expect(mileageEntryExpenseReportId.notNull).toBeTruthy();
        }

        expect(mileageEntryConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            )).toEqual(["mileage_entry_expense_report_tenant_fk"]);

        expect(mileageEntryConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            )).toEqual(["mileage_entry_tenant_report_idx"]);

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

        expect(migrationSql).toMatch(/"mileage_entry".*"tenant_id" uuid not null/s);
        expect(migrationSql).toMatch(/"mileage_entry".*"expense_report_id" uuid not null/s);

        expect(migrationSql).toContain('mileage_entry_expense_report_tenant_fk');
        expect(migrationSql).toContain('mileage_entry_tenant_report_idx');
    });
});
