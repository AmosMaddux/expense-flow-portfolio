import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { expenseReport } from "../schema/index.js";
import {
    readCaseQueueReportsForStage,
    readCaseQueueStageRollups,
} from "./caseQueueRollups.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

const tenantOneId = randomUUID();
const tenantTwoId = randomUUID();
let tenantTwoSubmittedReportIds: string[] = [];

type SyntheticExpenseReportValues = typeof expenseReport.$inferInsert & {
    id: string;
};

function buildExpenseReportValues(
    tenantId: string,
    currentStage: string,
    reportCount: number,
    dueDate: string,
): SyntheticExpenseReportValues[] {
    return Array.from({ length: reportCount }, () => {
        return {
            id: randomUUID(),
            currentStage,
            dueDate,
            owner: randomUUID(),
            tenantId,
        };
    });
}

void describe("readCaseQueueStageRollups", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        pool = new Pool({ connectionString: getCoreCaseTestDatabaseUrl() });
        db = drizzle(pool);

        const tenantTwoSubmittedReports = buildExpenseReportValues(
            tenantTwoId,
            "Submitted",
            3,
            "2026-06-30",
        );
        tenantTwoSubmittedReportIds = tenantTwoSubmittedReports.map(
            (report) => report.id,
        );

        await db
            .insert(expenseReport)
            .values([
                ...buildExpenseReportValues(
                    tenantOneId,
                    "Drafted",
                    1,
                    "2026-06-30",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "Drafted",
                    1,
                    "2026-07-02",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "AP Review",
                    2,
                    "2026-06-30",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "AP Review",
                    3,
                    "2026-07-02",
                ),
                ...tenantTwoSubmittedReports,
            ]);
    });

    afterAll(async () => {
        await pool?.end();
    });

    void test("returns tenant-scoped counts for every workflow stage", async () => {
        const rollups = await readCaseQueueStageRollups(db, {
            tenantId: tenantOneId,
            asOfDate: "2026-07-01",
        });

        expect(rollups).toEqual([
            {
                currentStage: "Drafted",
                reportCount: 2,
                overdueCount: 1,
            },
            {
                currentStage: "Submitted",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "Manager Approval",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "AP Review",
                reportCount: 5,
                overdueCount: 2,
            },
            {
                currentStage: "Paid",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "Reconciled",
                reportCount: 0,
                overdueCount: 0,
            },
        ]);
    });

    void test("returns tenant-scoped stage reports with a derived overdue flag", async () => {
        const reports = await readCaseQueueReportsForStage(db, {
            tenantId: tenantOneId,
            currentStage: "Drafted",
            asOfDate: "2026-07-01",
        });

        expect(
            reports.map((report) => ({
                currentStage: report.currentStage,
                dueDate: report.dueDate,
                isOverdue: report.isOverdue,
            })),
        ).toEqual([
            {
                currentStage: "Drafted",
                dueDate: "2026-06-30",
                isOverdue: true,
            },
            {
                currentStage: "Drafted",
                dueDate: "2026-07-02",
                isOverdue: false,
            },
        ]);

        expect(reports.every((report) => report.id.length > 0)).toBeTruthy();
    });

    void test("excludes another tenant's reports from stage queries", async () => {
        const tenantOneReports = await readCaseQueueReportsForStage(db, {
            tenantId: tenantOneId,
            currentStage: "Submitted",
            asOfDate: "2026-07-01",
        });
        const tenantTwoReports = await readCaseQueueReportsForStage(db, {
            tenantId: tenantTwoId,
            currentStage: "Submitted",
            asOfDate: "2026-07-01",
        });

        expect(tenantOneReports).toEqual([]);
        expect(
            tenantOneReports.some((report) =>
                tenantTwoSubmittedReportIds.includes(report.id),
            ),
        ).toBe(false);
        expect(tenantTwoReports).toHaveLength(3);
        expect(
            tenantTwoReports.every(
                (report) => report.currentStage === "Submitted",
            ),
        ).toBeTruthy();
    });
});
