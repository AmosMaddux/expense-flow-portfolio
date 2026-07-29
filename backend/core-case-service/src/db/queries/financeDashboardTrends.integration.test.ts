import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { expenseReport, lineItem } from "../schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { readFinanceDashboardTrend } from "./financeDashboardTrends.js";

const tenantOneId = "10000000-0000-4000-8000-000000000210";
const tenantTwoId = "99900000-0000-4000-8000-000000000210";
const ownerId = "20000000-0000-4000-8000-000000000210";

void describe("readFinanceDashboardTrend", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        pool = new Pool({ connectionString: getCoreCaseTestDatabaseUrl() });
        db = drizzle(pool);

        await db
            .insert(expenseReport)
            .values([
                buildExpenseReport(
                    "30000000-0000-4000-8000-000000000210",
                    tenantOneId,
                    "2026-07-01T00:00:00.000Z",
                ),
                buildExpenseReport(
                    "30000000-0000-4000-8000-000000000211",
                    tenantOneId,
                    "2026-07-02T12:30:00.000Z",
                ),
                buildExpenseReport(
                    "30000000-0000-4000-8000-000000000212",
                    tenantOneId,
                    "2026-07-03T23:59:59.000Z",
                ),
                buildExpenseReport(
                    "30000000-0000-4000-8000-000000000213",
                    tenantOneId,
                    "2026-07-04T00:00:00.000Z",
                ),
                buildExpenseReport(
                    "30000000-0000-4000-8000-000000000214",
                    tenantTwoId,
                    "2026-07-02T13:00:00.000Z",
                ),
            ]);
        await db
            .insert(lineItem)
            .values([
                buildLineItem(
                    "31000000-0000-4000-8000-000000000210",
                    tenantOneId,
                    "30000000-0000-4000-8000-000000000210",
                    "100.00",
                    "USD",
                ),
                buildLineItem(
                    "31000000-0000-4000-8000-000000000211",
                    tenantOneId,
                    "30000000-0000-4000-8000-000000000210",
                    "50.25",
                    "USD",
                ),
                buildLineItem(
                    "31000000-0000-4000-8000-000000000212",
                    tenantOneId,
                    "30000000-0000-4000-8000-000000000211",
                    "70.00",
                    "EUR",
                ),
                buildLineItem(
                    "31000000-0000-4000-8000-000000000213",
                    tenantOneId,
                    "30000000-0000-4000-8000-000000000211",
                    "30.00",
                    "USD",
                ),
                buildLineItem(
                    "31000000-0000-4000-8000-000000000214",
                    tenantTwoId,
                    "30000000-0000-4000-8000-000000000214",
                    "999.00",
                    "USD",
                ),
            ]);
    });

    afterAll(async () => {
        await pool?.end();
    });

    void test("returns inclusive tenant-scoped report creation volume and spend buckets by currency", async () => {
        const trend = await readFinanceDashboardTrend(db, {
            tenantId: tenantOneId,
            fromDate: "2026-07-01",
            toDate: "2026-07-03",
        });

        expect(trend).toEqual([
            {
                periodStart: "2026-07-01",
                reportCount: 1,
                spendByCurrency: [{ currency: "USD", spendAmount: "150.25" }],
            },
            {
                periodStart: "2026-07-02",
                reportCount: 1,
                spendByCurrency: [
                    { currency: "EUR", spendAmount: "70.00" },
                    { currency: "USD", spendAmount: "30.00" },
                ],
            },
            {
                periodStart: "2026-07-03",
                reportCount: 1,
                spendByCurrency: [],
            },
        ]);
    });

    void test("buckets report creation days in UTC regardless of database session timezone", async () => {
        await db.transaction(async (transaction) => {
            await transaction.execute(
                sql`set local time zone 'America/Los_Angeles'`,
            );

            const trend = await readFinanceDashboardTrend(transaction, {
                tenantId: tenantOneId,
                fromDate: "2026-07-03",
                toDate: "2026-07-03",
            });

            expect(trend).toEqual([
                {
                    periodStart: "2026-07-03",
                    reportCount: 1,
                    spendByCurrency: [],
                },
            ]);
        });
    });
    void test("generates zero-count days inside the requested range", async () => {
        const trend = await readFinanceDashboardTrend(db, {
            tenantId: tenantOneId,
            fromDate: "2026-07-05",
            toDate: "2026-07-06",
        });

        expect(trend).toEqual([
            {
                periodStart: "2026-07-05",
                reportCount: 0,
                spendByCurrency: [],
            },
            {
                periodStart: "2026-07-06",
                reportCount: 0,
                spendByCurrency: [],
            },
        ]);
    });
});

function buildExpenseReport(id: string, tenantId: string, createdAt: string) {
    return {
        id,
        createdAt: new Date(createdAt),
        currentStage: "Submitted",
        dueDate: "2026-08-01",
        owner: ownerId,
        tenantId,
    };
}

function buildLineItem(
    id: string,
    tenantId: string,
    expenseReportId: string,
    amount: string,
    currency: string,
) {
    return {
        id,
        amount,
        category: "Travel",
        currency,
        expenseReportId,
        merchant: "Synthetic Merchant",
        tenantId,
    };
}
