import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import { AllTransactionPageSchema } from "../../schemas/expense-report.schema.js";
import {
    readTenantAllTransactions,
    type AllTransactionsServiceDependencies,
} from "./allTransactionsService.js";
import type { AllTransaction } from "../../schemas/expense-report.schema.js";

const allTransactionsPageContractFixtureUrl = new URL(
    "../../../../../frontend/app/src/transactions/__fixtures__/allTransactionsPage.contract.json",
    import.meta.url,
);

void describe("readTenantAllTransactions", () => {
    void test("accepts the shared frontend All Transactions page contract fixture", async () => {
        const fixture = JSON.parse(
            await readFile(allTransactionsPageContractFixtureUrl, "utf8"),
        ) as unknown;

        expect(() => AllTransactionPageSchema.parse(fixture)).not.toThrow();
    });

    void test("passes a validated tenant-scoped request to the transaction store", async () => {
        const readAllTransactions = vi.fn().mockResolvedValue({
            items: [
                {
                    id: "30000000-0000-4000-8000-000000000180",
                    expenseReportId: "60000000-0000-4000-8000-000000000180",
                    date: "2026-07-20T12:00:00.000Z",
                    merchant: "Cedar Bistro",
                    category: "Meals",
                    amount: "64.20",
                    currency: "USD",
                    status: "AP Review",
                    deductible: null,
                    owner: "50000000-0000-4000-8000-000000000180",
                    priority: "Normal",
                    dueDate: "2026-08-01",
                    onHold: false,
                    isOverdue: false,
                    glCode: "6250",
                    flaggedLineItem: false,
                    reviewAction: null,
                },
            ],
            nextCursor: null,
        });
        const dependencies: AllTransactionsServiceDependencies = {
            transactionStore: { readAllTransactions },
        };

        const transactions = await readTenantAllTransactions(
            {
                tenantId: "40000000-0000-4000-8000-000000000180",
                category: "Meals",
                status: "AP Review",
                startDate: "2026-07-01",
                endDate: "2026-07-31",
            },
            dependencies,
        );

        expect(readAllTransactions).toHaveBeenCalledWith({
            tenantId: "40000000-0000-4000-8000-000000000180",
            category: "Meals",
            status: "AP Review",
            startDate: "2026-07-01",
            endDate: "2026-07-31",
            limit: 50,
        });
        expect(transactions.items).toHaveLength(1);
        expect(transactions.nextCursor).toBeNull();
    });

    void test("computes overdue values with an injectable UTC clock", async () => {
        const baseTransaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000183",
            expenseReportId: "60000000-0000-4000-8000-000000000183",
            date: "2026-07-20T12:00:00.000Z",
            merchant: "Cedar Bistro",
            category: "Meals",
            amount: "64.20",
            currency: "USD",
            status: "AP Review",
            deductible: null,
            owner: "50000000-0000-4000-8000-000000000183",
            priority: "Normal",
            dueDate: "2026-07-30",
            onHold: false,
            isOverdue: false,
            glCode: "6250",
            flaggedLineItem: false,
            reviewAction: null,
        };
        const readAllTransactions = vi.fn().mockResolvedValue({
            items: [
                {
                    ...baseTransaction,
                    id: "30000000-0000-4000-8000-000000000183",
                    dueDate: "2026-07-29",
                },
                {
                    ...baseTransaction,
                    id: "30000000-0000-4000-8000-000000000184",
                    dueDate: "2026-07-30",
                },
                {
                    ...baseTransaction,
                    id: "30000000-0000-4000-8000-000000000185",
                    dueDate: "2026-07-29",
                    status: "Reconciled",
                },
                {
                    ...baseTransaction,
                    id: "30000000-0000-4000-8000-000000000186",
                    dueDate: "2026-07-31",
                },
            ],
            nextCursor: null,
        });
        const dependencies: AllTransactionsServiceDependencies = {
            now: () => new Date("2026-07-30T23:59:59.999Z"),
            transactionStore: { readAllTransactions },
        };

        const transactions = await readTenantAllTransactions(
            {
                tenantId: "40000000-0000-4000-8000-000000000183",
            },
            dependencies,
        );

        expect(
            transactions.items.map(({ id, isOverdue }) => ({
                id,
                isOverdue,
            })),
        ).toEqual([
            {
                id: "30000000-0000-4000-8000-000000000183",
                isOverdue: true,
            },
            {
                id: "30000000-0000-4000-8000-000000000184",
                isOverdue: false,
            },
            {
                id: "30000000-0000-4000-8000-000000000185",
                isOverdue: false,
            },
            {
                id: "30000000-0000-4000-8000-000000000186",
                isOverdue: false,
            },
        ]);
    });

    void test("uses UTC date boundaries when deriving the service clock date", async () => {
        const readAllTransactions = vi.fn().mockResolvedValue({
            items: [
                {
                    id: "30000000-0000-4000-8000-000000000187",
                    expenseReportId: "60000000-0000-4000-8000-000000000187",
                    date: "2026-07-20T12:00:00.000Z",
                    merchant: "Cedar Bistro",
                    category: "Meals",
                    amount: "64.20",
                    currency: "USD",
                    status: "AP Review",
                    deductible: null,
                    owner: "50000000-0000-4000-8000-000000000187",
                    priority: "Normal",
                    dueDate: "2026-07-30",
                    onHold: false,
                    isOverdue: true,
                    glCode: "6250",
                    flaggedLineItem: false,
                    reviewAction: null,
                },
            ],
            nextCursor: null,
        });
        const dependencies: AllTransactionsServiceDependencies = {
            now: () => new Date("2026-07-31T00:00:00.000Z"),
            transactionStore: { readAllTransactions },
        };

        const transactions = await readTenantAllTransactions(
            {
                tenantId: "40000000-0000-4000-8000-000000000187",
            },
            dependencies,
        );

        expect(transactions.items[0]?.isOverdue).toBe(true);
    });

    void test("rejects invalid date ranges before querying the store", async () => {
        const readAllTransactions = vi.fn();
        const dependencies: AllTransactionsServiceDependencies = {
            transactionStore: { readAllTransactions },
        };

        await expect(
            readTenantAllTransactions(
                {
                    tenantId: "40000000-0000-4000-8000-000000000181",
                    startDate: "2026-07-31",
                    endDate: "2026-07-01",
                },
                dependencies,
            ),
        ).rejects.toThrow();
        expect(readAllTransactions).not.toHaveBeenCalled();
    });

    void test("accepts expense-date cursors and rejects created-at cursors", async () => {
        const readAllTransactions = vi.fn().mockResolvedValue({
            items: [],
            nextCursor: null,
        });
        const dependencies: AllTransactionsServiceDependencies = {
            transactionStore: { readAllTransactions },
        };
        const expenseDateCursor = Buffer.from(
            JSON.stringify({
                expenseDate: "2026-07-20",
                id: "30000000-0000-4000-8000-000000000182",
            }),
        ).toString("base64url");
        const createdAtCursor = Buffer.from(
            JSON.stringify({
                createdAt: "2026-07-20T00:00:00.000Z",
                id: "30000000-0000-4000-8000-000000000182",
            }),
        ).toString("base64url");

        await expect(
            readTenantAllTransactions(
                {
                    tenantId: "40000000-0000-4000-8000-000000000182",
                    cursor: expenseDateCursor,
                },
                dependencies,
            ),
        ).resolves.toEqual({ items: [], nextCursor: null });
        expect(readAllTransactions).toHaveBeenCalledWith({
            tenantId: "40000000-0000-4000-8000-000000000182",
            cursor: expenseDateCursor,
            limit: 50,
        });

        await expect(
            readTenantAllTransactions(
                {
                    tenantId: "40000000-0000-4000-8000-000000000182",
                    cursor: createdAtCursor,
                },
                dependencies,
            ),
        ).rejects.toThrow();
        expect(readAllTransactions).toHaveBeenCalledTimes(1);
    });
});
