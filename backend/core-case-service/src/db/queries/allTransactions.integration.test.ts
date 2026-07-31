import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { expenseReport, glCodingResult, lineItem } from "../schema/index.js";
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
                expenseDate: "2026-07-01",
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
                expenseDate: "2026-07-03",
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
                expenseDate: "2026-07-05",
                createdAt: new Date("2026-08-05T10:00:00.000Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000104",
                expenseReportId: "84000000-0000-4000-8000-000000000102",
                tenantId: tenantOneId,
                merchant: "Alpine Shuttle",
                amount: "37.00",
                currency: "USD",
                category: "Ground Transport",
                expenseDate: "2026-07-05",
                createdAt: new Date("2026-08-04T10:00:00.000Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000201",
                expenseReportId: "84000000-0000-4000-8000-000000000201",
                tenantId: tenantTwoId,
                merchant: "Other Tenant Rail",
                amount: "18.00",
                currency: "USD",
                category: "Travel",
                expenseDate: "2026-07-06",
                createdAt: new Date("2026-07-06T10:00:00.000Z"),
            },
        ]);

        await db.insert(glCodingResult).values({
            id: "86000000-0000-4000-8000-000000000103",
            submissionId: "87000000-0000-4000-8000-000000000103",
            tenantId: tenantOneId,
            expenseReportId: "84000000-0000-4000-8000-000000000102",
            sourceType: "line_item",
            sourceId: "85000000-0000-4000-8000-000000000103",
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6220",
            glAccountName: "Travel",
            amount: "512.09",
            currency: "USD",
            flaggedLineItem: true,
            flagCode: "amount_over_500",
            flagMessage: "Line item exceeds $500.",
            lineItemReviewAction: "approve",
            lineItemReviewedBy: ownerId,
            lineItemReviewedAt: new Date("2026-07-06T10:00:00.000Z"),
            codedAt: new Date("2026-07-05T10:00:00.000Z"),
        });
    });

    afterAll(async () => {
        await pool?.end();
    });

    void test("lists tenant-scoped line items across reports newest first", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
            limit: 50,
        });

        expect(transactions.items.map((transaction) => transaction.id)).toEqual(
            [
                "85000000-0000-4000-8000-000000000103",
                "85000000-0000-4000-8000-000000000104",
                "85000000-0000-4000-8000-000000000102",
                "85000000-0000-4000-8000-000000000101",
            ],
        );
        expect(
            transactions.items.map((transaction) => transaction.merchant),
        ).toEqual([
            "Summit Air",
            "Alpine Shuttle",
            "Bluebird Cafe",
            "Northstar Office",
        ]);
        expect(
            transactions.items.every(
                (transaction) => transaction.deductible === null,
            ),
        ).toBe(true);
        expect(transactions.items[0]).toMatchObject({
            owner: ownerId,
            priority: "Normal",
            dueDate: "2026-08-02",
            onHold: false,
            isOverdue: false,
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
        });
        expect(transactions.items[1]).toMatchObject({
            glCode: null,
            flaggedLineItem: false,
            reviewAction: null,
        });
        expect(
            transactions.items.some(
                (transaction) => transaction.merchant === "Other Tenant Rail",
            ),
        ).toBe(false);
        expect(transactions.nextCursor).toBeNull();
    });

    void test("filters by category, status, and inclusive date range", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
            category: "Travel",
            status: "AP Review",
            startDate: "2026-07-05",
            endDate: "2026-07-05",
            limit: 50,
        });

        expect(transactions.items).toHaveLength(1);
        expect(transactions.items[0]).toMatchObject({
            id: "85000000-0000-4000-8000-000000000103",
            expenseReportId: "84000000-0000-4000-8000-000000000102",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            deductible: null,
            owner: ownerId,
            priority: "Normal",
            dueDate: "2026-08-02",
            onHold: false,
            isOverdue: false,
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
        });
        expect(transactions.items[0]?.date).toBe("2026-07-05T00:00:00.000Z");
    });

    void test("uses expense dates for date filters", async () => {
        const boundaryTenantId = "81000000-0000-4000-8000-000000000300";
        await db.insert(expenseReport).values({
            id: "84000000-0000-4000-8000-000000000301",
            currentStage: "AP Review",
            dueDate: "2026-08-01",
            owner: ownerId,
            tenantId: boundaryTenantId,
        });
        await db.insert(lineItem).values([
            {
                id: "85000000-0000-4000-8000-000000000301",
                expenseReportId: "84000000-0000-4000-8000-000000000301",
                tenantId: boundaryTenantId,
                merchant: "Late Day Cafe",
                amount: "24.00",
                currency: "USD",
                category: "Meals",
                expenseDate: "2026-07-05",
                createdAt: new Date("2026-08-05T23:59:59.999Z"),
            },
            {
                id: "85000000-0000-4000-8000-000000000302",
                expenseReportId: "84000000-0000-4000-8000-000000000301",
                tenantId: boundaryTenantId,
                merchant: "Midnight Market",
                amount: "18.00",
                currency: "USD",
                category: "Meals",
                expenseDate: "2026-07-06",
                createdAt: new Date("2026-08-06T00:00:00.000Z"),
            },
        ]);

        const transactions = await readAllTransactions(db, {
            tenantId: boundaryTenantId,
            startDate: "2026-07-05",
            endDate: "2026-07-05",
            limit: 50,
        });

        expect(transactions.items.map((transaction) => transaction.id)).toEqual(
            ["85000000-0000-4000-8000-000000000301"],
        );
    });

    void test("returns no rows when filters only match another tenant", async () => {
        const transactions = await readAllTransactions(db, {
            tenantId: tenantOneId,
            category: "Travel",
            status: "Submitted",
            startDate: "2026-07-06",
            endDate: "2026-07-06",
            limit: 50,
        });

        expect(transactions).toEqual({ items: [], nextCursor: null });
    });

    void test("returns stable keyset pages without duplicate rows", async () => {
        const firstPage = await readAllTransactions(db, {
            tenantId: tenantOneId,
            limit: 2,
        });

        expect(
            firstPage.items.map((transaction) => transaction.merchant),
        ).toEqual(["Summit Air", "Alpine Shuttle"]);
        expect(firstPage.nextCursor).toEqual(expect.any(String));

        const secondPage = await readAllTransactions(db, {
            tenantId: tenantOneId,
            cursor: firstPage.nextCursor ?? undefined,
            limit: 2,
        });

        expect(
            secondPage.items.map((transaction) => transaction.merchant),
        ).toEqual(["Bluebird Cafe", "Northstar Office"]);
        expect(secondPage.nextCursor).toBeNull();
    });
});
