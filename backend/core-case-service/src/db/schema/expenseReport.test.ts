import { describe, test } from "node:test";
import assert from "node:assert/strict";

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
        assert.deepEqual(approvedWorkflowStages, [
            "Drafted",
            "Submitted",
            "Manager Approval",
            "AP Review",
            "Paid",
            "Reconciled",
        ]);

        assert.deepEqual(priorityLevels, ["Low", "Normal", "High", "Urgent"]);
    });

    void test("defines the expense_report table with required case columns", () => {
        const tableConfig = getTableConfig(expenseReport);
        const columnNames = tableConfig.columns.map((column) => column.name);

        assert.equal(getTableName(expenseReport), "expense_report");
        assert.equal(columnNames.includes("status"), false);

        for (const columnName of requiredExpenseReportColumnNames) {
            assert.equal(columnNames.includes(columnName), true);
        }

        const tenantId = tableConfig.columns.find(
            (column) => column.name === "tenant_id",
        );

        if (tenantId === undefined) {
            assert.fail("tenant_id column is missing");
        }

        assert.equal(tenantId.notNull, true);
    });

    void test("keeps check constraints and tenant-scoped indexes on the table", () => {
        const tableConfig = getTableConfig(expenseReport);

        assert.deepEqual(
            tableConfig.checks.map((constraint) => constraint.name).sort(),
            [
                "expense_report_current_stage_check",
                "expense_report_hold_reason_check",
                "expense_report_priority_check",
            ],
        );

        assert.deepEqual(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
            [
                "expense_report_tenant_stage_idx",
                "expense_report_tenant_due_date_idx",
                "expense_report_tenant_owner_idx",
                "expense_report_tenant_priority_idx",
                "expense_report_tenant_id_unique_idx",
            ],
        );

        const tenantReportIndex = tableConfig.indexes.find(
            (indexConfig) =>
                indexConfig.config.name ===
                "expense_report_tenant_id_unique_idx",
        );

        if (tenantReportIndex === undefined) {
            assert.fail("expense_report tenant/id unique index is missing");
        }

        assert.equal(tenantReportIndex.config.unique, true);
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

        assert.match(migrationSql, /create table "expense_report"/);
        assert.doesNotMatch(migrationSql, /\bstatus\b/);

        for (const columnName of requiredExpenseReportColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        assert.match(migrationSql, /"tenant_id" uuid not null/);
        assert.match(migrationSql, /expense_report_current_stage_check/);
        assert.match(migrationSql, /expense_report_priority_check/);
        assert.match(migrationSql, /expense_report_hold_reason_check/);
        assert.match(migrationSql, /expense_report_tenant_stage_idx/);
        assert.match(migrationSql, /expense_report_tenant_due_date_idx/);
        assert.match(migrationSql, /expense_report_tenant_owner_idx/);
        assert.match(migrationSql, /expense_report_tenant_priority_idx/);
        assert.match(migrationSql, /expense_report_tenant_id_unique_idx/);
    });
});

void describe("lineItem schema", () => {
    void test("defines the line_item table with normalized transaction columns", () => {
        const tableConfig = getTableConfig(lineItem);
        const columnNames = tableConfig.columns.map((column) => column.name);

        assert.equal(getTableName(lineItem), "line_item");

        for (const columnName of requiredLineItemColumnNames) {
            assert.equal(columnNames.includes(columnName), true);
        }

        const tenantId = tableConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const expenseReportId = tableConfig.columns.find(
            (column) => column.name === "expense_report_id",
        );

        if (tenantId === undefined || expenseReportId === undefined) {
            assert.fail("tenant_id or expense_report_id column is missing");
        }

        assert.equal(tenantId.notNull, true);
        assert.equal(expenseReportId.notNull, true);
    });

    void test("keeps tenant-scoped lookup indexes on line items", () => {
        const tableConfig = getTableConfig(lineItem);

        assert.deepEqual(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
            ["line_item_tenant_expense_report_idx"],
        );
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

        assert.deepEqual(foreignKeys, [
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

        assert.match(migrationSql, /create table "line_item"/);

        for (const columnName of requiredLineItemColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        assert.match(migrationSql, /"amount" numeric\(12, 2\) not null/);
        assert.match(migrationSql, /"tenant_id" uuid not null/);
        assert.match(migrationSql, /"expense_report_id" uuid not null/);
        assert.match(
            migrationSql,
            /foreign key \("tenant_id","expense_report_id"\) references "public"\."expense_report"\("tenant_id","id"\)/,
        );
        assert.match(migrationSql, /line_item_tenant_expense_report_idx/);
    });
});

void describe("receiptMetadata schema", () => {
    void test("defines the receipt_metadata child table", () => {
        const receiptMetadataConfig = getTableConfig(receiptMetadata);
        const receiptMetadataColumnNames = receiptMetadataConfig.columns.map(
            (column) => column.name,
        );

        assert.equal(getTableName(receiptMetadata), "receipt_metadata");

        for (const columnName of receiptMetadataRequiredColumnNames) {
            assert.equal(receiptMetadataColumnNames.includes(columnName), true);
        }

        const receiptMetadataTenantId = receiptMetadataConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const receiptMetadataExpenseReportId =
            receiptMetadataConfig.columns.find(
                (column) => column.name === "expense_report_id",
            );

        if (
            receiptMetadataTenantId === undefined ||
            receiptMetadataExpenseReportId === undefined
        ) {
            assert.fail(
                "receipt_metadata tenant_id and expense_report_id columns are required",
            );
        }

        assert.equal(receiptMetadataTenantId.notNull, true);
        assert.equal(receiptMetadataExpenseReportId.notNull, true);

        assert.deepEqual(
            receiptMetadataConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
            ["receipt_metadata_expense_report_tenant_fk"],
        );

        assert.deepEqual(
            receiptMetadataConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
            ["receipt_metadata_tenant_report_idx"],
        );
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

        assert.match(migrationSql, /create table "receipt_metadata"/);

        for (const columnName of receiptMetadataRequiredColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        assert.match(migrationSql, /"amount" numeric\(12, 2\) not null/);
        assert.match(migrationSql, /"blob_reference" jsonb not null/);
        assert.match(
            migrationSql,
            /"receipt_metadata".*"tenant_id" uuid not null/s,
        );
        assert.match(
            migrationSql,
            /"receipt_metadata".*"expense_report_id" uuid not null/s,
        );
        assert.match(migrationSql, /receipt_metadata_expense_report_tenant_fk/);
        assert.match(migrationSql, /receipt_metadata_tenant_report_idx/);
    });
});

void describe("mileageEntry schema", () => {
    void test("defines the mileage_entry child table", () => {
        const mileageEntryConfig = getTableConfig(mileageEntry);
        const mileageEntryColumnNames = mileageEntryConfig.columns.map(
            (column) => column.name,
        );

        assert.equal(getTableName(mileageEntry), "mileage_entry");

        for (const columnName of mileageEntryRequiredColumnNames) {
            assert.equal(mileageEntryColumnNames.includes(columnName), true);
        }

        const mileageEntryTenantId = mileageEntryConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const mileageEntryExpenseReportId = mileageEntryConfig.columns.find(
            (column) => column.name === "expense_report_id",
        );

        if (
            mileageEntryTenantId === undefined ||
            mileageEntryExpenseReportId === undefined
        ) {
            assert.fail(
                "mileage_entry tenant_id and expense_report_id columns are required",
            );
        }

        assert.equal(mileageEntryTenantId.notNull, true);
        assert.equal(mileageEntryExpenseReportId.notNull, true);

        assert.deepEqual(
            mileageEntryConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
            ["mileage_entry_expense_report_tenant_fk"],
        );

        assert.deepEqual(
            mileageEntryConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
            ["mileage_entry_tenant_report_idx"],
        );
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

        assert.match(migrationSql, /create table "mileage_entry"/);

        for (const columnName of mileageEntryRequiredColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        assert.match(migrationSql, /"distance" numeric\(8, 2\) not null/);
        assert.match(
            migrationSql,
            /"mileage_entry".*"tenant_id" uuid not null/s,
        );
        assert.match(
            migrationSql,
            /"mileage_entry".*"expense_report_id" uuid not null/s,
        );
        assert.match(migrationSql, /mileage_entry_expense_report_tenant_fk/);
        assert.match(migrationSql, /mileage_entry_tenant_report_idx/);
    });
});
