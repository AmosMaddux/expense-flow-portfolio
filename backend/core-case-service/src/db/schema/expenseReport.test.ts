import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

import {
    approvedWorkflowStages,
    expenseReport,
    mileageEntry,
    priorityLevels,
    receiptMetadata,
} from "./expenseReport.js";

const requiredColumnNames = [
    "current_stage",
    "on_hold",
    "hold_reason",
    "owner",
    "priority",
    "due_date",
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

        for (const columnName of requiredColumnNames) {
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
                "expense_report_tenant_id_id_uidx",
            ],
        );

        const tenantReportIndex = tableConfig.indexes.find(
            (indexConfig) =>
                indexConfig.config.name === "expense_report_tenant_id_id_uidx",
        );

        if (tenantReportIndex === undefined) {
            assert.fail("expense_report tenant/id unique index is missing");
        }

        assert.equal(tenantReportIndex.config.unique, true);
    });

    void test("defines receipt metadata and mileage entry child tables", () => {
        const receiptMetadataConfig = getTableConfig(receiptMetadata);
        const mileageEntryConfig = getTableConfig(mileageEntry);
        const receiptMetadataColumnNames = receiptMetadataConfig.columns.map(
            (column) => column.name,
        );
        const mileageEntryColumnNames = mileageEntryConfig.columns.map(
            (column) => column.name,
        );

        assert.equal(getTableName(receiptMetadata), "receipt_metadata");
        assert.equal(getTableName(mileageEntry), "mileage_entry");

        for (const columnName of receiptMetadataRequiredColumnNames) {
            assert.equal(receiptMetadataColumnNames.includes(columnName), true);
        }

        for (const columnName of mileageEntryRequiredColumnNames) {
            assert.equal(mileageEntryColumnNames.includes(columnName), true);
        }

        const receiptMetadataTenantId = receiptMetadataConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const receiptMetadataExpenseReportId =
            receiptMetadataConfig.columns.find(
                (column) => column.name === "expense_report_id",
            );
        const mileageEntryTenantId = mileageEntryConfig.columns.find(
            (column) => column.name === "tenant_id",
        );
        const mileageEntryExpenseReportId = mileageEntryConfig.columns.find(
            (column) => column.name === "expense_report_id",
        );

        if (
            receiptMetadataTenantId === undefined ||
            receiptMetadataExpenseReportId === undefined ||
            mileageEntryTenantId === undefined ||
            mileageEntryExpenseReportId === undefined
        ) {
            assert.fail("tenant_id and expense_report_id columns are required");
        }

        assert.equal(receiptMetadataTenantId.notNull, true);
        assert.equal(receiptMetadataExpenseReportId.notNull, true);
        assert.equal(mileageEntryTenantId.notNull, true);
        assert.equal(mileageEntryExpenseReportId.notNull, true);

        assert.deepEqual(
            receiptMetadataConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
            ["receipt_metadata_expense_report_tenant_fk"],
        );
        assert.deepEqual(
            mileageEntryConfig.foreignKeys.map((foreignKey) =>
                foreignKey.getName(),
            ),
            ["mileage_entry_expense_report_tenant_fk"],
        );

        assert.deepEqual(
            receiptMetadataConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
            ["receipt_metadata_tenant_report_idx"],
        );
        assert.deepEqual(
            mileageEntryConfig.indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
            ["mileage_entry_tenant_report_idx"],
        );
    });

    void test("generates SQL for the tables, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({
            expenseReport,
            receiptMetadata,
            mileageEntry,
        });
        const migrationStatements = await generateMigration(
            previousSnapshot,
            currentSnapshot,
        );
        const migrationSql = migrationStatements.join("\n").toLowerCase();

        assert.match(migrationSql, /create table "expense_report"/);
        assert.doesNotMatch(migrationSql, /\bstatus\b/);

        for (const columnName of requiredColumnNames) {
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
        assert.match(migrationSql, /expense_report_tenant_id_id_uidx/);

        assert.match(migrationSql, /create table "receipt_metadata"/);
        assert.match(migrationSql, /create table "mileage_entry"/);

        for (const columnName of receiptMetadataRequiredColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        for (const columnName of mileageEntryRequiredColumnNames) {
            assert.match(migrationSql, new RegExp(`"${columnName}"`));
        }

        assert.match(migrationSql, /"amount" numeric\(12, 2\) not null/);
        assert.match(migrationSql, /"blob_reference" jsonb not null/);
        assert.match(migrationSql, /"distance" numeric\(8, 2\) not null/);
        assert.match(
            migrationSql,
            /"receipt_metadata".*"tenant_id" uuid not null/s,
        );
        assert.match(
            migrationSql,
            /"receipt_metadata".*"expense_report_id" uuid not null/s,
        );
        assert.match(
            migrationSql,
            /"mileage_entry".*"tenant_id" uuid not null/s,
        );
        assert.match(
            migrationSql,
            /"mileage_entry".*"expense_report_id" uuid not null/s,
        );
        assert.match(migrationSql, /receipt_metadata_expense_report_tenant_fk/);
        assert.match(migrationSql, /mileage_entry_expense_report_tenant_fk/);
        assert.match(migrationSql, /receipt_metadata_tenant_report_idx/);
        assert.match(migrationSql, /mileage_entry_tenant_report_idx/);
    });
});
