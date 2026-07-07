import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import type { NewExpenseReport } from "../../db/schema/expenseReport.js";
import {
    auditEntry,
    expenseReport,
    stageTransition,
} from "../../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

vi.mock("../../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(client);
    return {
        db,
    };
});

import { db } from "../../db/client.js";
import {
    findExpenseReportById,
    insertDraftExpenseReport,
} from "./expenseReportRepository.js";

void describe("expenseReportRepository", () => {
    function buildNewExpenseReport(
        tenantId?: string,
        ownerId?: string,
    ): NewExpenseReport {
        return {
            tenantId: tenantId ?? "00000000-0000-0000-0000-000000000083",
            owner: ownerId ?? "20000000-0000-0000-0000-000000000083",
            dueDate: "2026-07-02",
        };
    }

    void test("inserts a Drafted Expense Report", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000183";

        const newReport = buildNewExpenseReport(targetTenantId);

        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        expect(report).toBeDefined();
        expect(report?.tenantId).toEqual(targetTenantId);
        expect(report?.currentStage).toEqual("Drafted");
        expect(report?.id).not.toBeUndefined();
    });

    void test("writes creation audit and initial stage transition", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000184";

        const newReport = buildNewExpenseReport(targetTenantId);

        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, report.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, report.id));

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            actorId: report.owner,
            action: "report_created",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
            denialReason: null,
        });
        expect(transitionRows).toHaveLength(1);
        expect(transitionRows[0]).toMatchObject({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            actor: report.owner,
            fromStage: "Drafted",
            toStage: "Drafted",
            reason: "report_created",
        });
    });

    void test("rejects mismatched tenant inserts", async () => {
        const reportTenantId = "00000000-0000-4000-8000-000000000185";
        const sessionTenantId = "00000000-0000-4000-8000-000000000195";

        const newReport = buildNewExpenseReport(reportTenantId);

        const report = await insertDraftExpenseReport(
            sessionTenantId,
            newReport,
        );

        expect(report).toBeUndefined();

        const reports = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.tenantId, reportTenantId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.tenantId, reportTenantId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.tenantId, reportTenantId));

        expect(reports).toHaveLength(0);
        expect(auditRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(0);
    });

    void test("finds an Expense Report by id", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000186";
        const targetId = "10000000-0000-4000-8000-000000000186";

        const newReport = buildNewExpenseReport(targetTenantId);
        newReport.id = targetId;

        const insertedReport = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );
        expect(insertedReport).toBeDefined();

        const foundReport = await findExpenseReportById(
            targetTenantId,
            targetId,
        );

        expect(foundReport?.id).toEqual(targetId);
        expect(foundReport?.tenantId).toEqual(targetTenantId);
    });

    void test("returns undefined when an Expense Report is absent", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000187";
        const targetId = "10000000-0000-4000-8000-000000000187";

        const foundReport = await findExpenseReportById(
            targetTenantId,
            targetId,
        );

        expect(foundReport).toBeUndefined();
    });

    void test("does not find another tenant's Expense Report", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000188";
        const otherTenantId = "00000000-0000-4000-8000-000000000198";
        const targetId = "10000000-0000-4000-8000-000000000188";

        const newReport = buildNewExpenseReport(targetTenantId);
        newReport.id = targetId;

        const insertedReport = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );
        expect(insertedReport).toBeDefined();

        const foundReport = await findExpenseReportById(
            otherTenantId,
            targetId,
        );

        expect(foundReport).toBeUndefined();
    });
});
