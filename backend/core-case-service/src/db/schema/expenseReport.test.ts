import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

import {
    approvedWorkflowStages,
    expenseReport,
    lineItem,
    priorityLevels,
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
            ],
        );
    });

    void test("generates SQL for the table, constraints, and indexes", async () => {
        // Drizzle Kit's API return type is valid for TypeScript, but strict ESLint
        // treats this generated snapshot type as unsafe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previousSnapshot = generateDrizzleJson({});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSnapshot = generateDrizzleJson({ expenseReport });
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
            /foreign key \("expense_report_id"\) references "public"\."expense_report"\("id"\)/,
        );
        assert.match(migrationSql, /line_item_tenant_expense_report_idx/);
    });
});
