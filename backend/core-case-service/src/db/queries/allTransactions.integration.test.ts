import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { expenseReport, lineItem } from "../schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { readAllTransactions } from "./allTransactions.js";

const tenantOneId = "81000000-0000-4000-8000-000000000100";
const tenantTwoId = "82000000-0000-4000-8000-000000000100";
const ownerId = "83000000-0000-4000-8000-000000000100";

void describe("readAllTransactions", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        pool = new Pool({ connectionString: getCoreCaseTestDatabaseUrl() });
        db = drizzle(pool);

        await db.insert(expenseReport).values([
            {
                id: "84000000-0000-4000-8000-000000000101",
                currentStage: "Submitted",
                dueDate: "2026-08-01",
                owner: ownerId,
                tenantId: tenantOneId,
            },
            {
                id: "84000000-0000-4000-8000-000000000102",
                currentStage: "AP Review",
                dueDate: "2026-08-02",
                owner: ownerId,
                tenantId: tenantOneId,
            },
            {
                id: "84000000-0000-4000-8000-000000000201",
                currentStage: "Submitted",
                dueDate: "2026-08-01",
                owner: ownerId,
                tenantId: tenantTwoId,
            },
        ]);

        await db.insert(lineItem).values([
            {
                id: "85000000-0000-4000-8000-000000000101",
                expenseReportId: "84000000-0000-4000-8000-000000000101",
                tenantId: tenantOneId,
                merchant: "Northstar Office",
                amount: "92.41",
                currency: "USD",
                category: "Office Supplies",
                createdAt: new Date("2026-07-01T10:00:00.000Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000102",
                expenseReportId: "84000000-0000-4000-8000-000000000102",
                tenantId: tenantOneId,
                merchant: "Bluebird Cafe",
                amount: "41.25",
                currency: "USD",
                category: "Meals",
                createdAt: new Date("2026-07-03T10:00:00.000Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000103",
                expenseReportId: "84000000-0000-4000-8000-000000000102",
                tenantId: tenantOneId,
                merchant: "Summit Air",
                amount: "512.09",
                currency: "USD",
                category: "Travel",
                createdAt: new Date("2026-07-05T10:00:00.000Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000201",
                expenseReportId: "84000000-0000-4000-8000-000000000201",
                tenantId: tenantTwoId,
                merchant: "Other Tenant Rail",
                amount: "18.00",
                currency: "USD",
                category: "Travel",
                createdAt: new Date("2026-07-06T10:00:00.000Z"),
            },
        ]);
    });

    afterAll(async () => {
        await pool?.end();
    });

    void test("lists tenant-scoped line items across reports newest first", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
        });

        expect(transactions.map((transaction) => transaction.merchant)).toEqual(
            ["Summit Air", "Bluebird Cafe", "Northstar Office"],
        );
        expect(
            transactions.every(
                (transaction) => transaction.deductible === null,
            ),
        ).toBe(true);
        expect(
            transactions.some(
                (transaction) => transaction.merchant === "Other Tenant Rail",
            ),
        ).toBe(false);
    });

    void test("filters by category, status, and inclusive date range", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
            category: "Travel",
            status: "AP Review",
            startDate: "2026-07-05",
            endDate: "2026-07-05",
        });

        expect(transactions).toHaveLength(1);
        expect(transactions[0]).toMatchObject({
            id: "85000000-0000-4000-8000-000000000103",
            expenseReportId: "84000000-0000-4000-8000-000000000102",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            deductible: null,
        });
        expect(transactions[0]?.date).toBe("2026-07-05T10:00:00.000Z");
    });

    void test("returns no rows when filters only match another tenant", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
            category: "Travel",
            status: "Submitted",
            startDate: "2026-07-06",
            endDate: "2026-07-06",
        });

        expect(transactions).toEqual([]);
    });
});
