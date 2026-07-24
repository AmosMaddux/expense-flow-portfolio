import { describe, expect, test, vi } from "vitest";

import {
    readTenantAllTransactions,
    type AllTransactionsServiceDependencies,
} from "./allTransactionsService.js";

void describe("readTenantAllTransactions", () => {
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
});
