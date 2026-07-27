import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import { AllTransactionPageSchema } from "../../schemas/expense-report.schema.js";
import {
    readTenantAllTransactions,
    type AllTransactionsServiceDependencies,
} from "./allTransactionsService.js";

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
