import { afterEach, describe, expect, test, vi } from "vitest";

import {
    createDynamoExpenseReportCaseStore,
    readExpenseReportTableName,
} from "./expenseReportCaseStore.js";

afterEach(() => {
    delete process.env.DYNAMODB_EXPENSE_REPORT_TABLE;
});

void describe("DynamoDB Expense Report case store", () => {
    void test("requires a configured Expense Report table", () => {
        expect(() => readExpenseReportTableName()).toThrow(
            "DYNAMODB_EXPENSE_REPORT_TABLE is required.",
        );

        process.env.DYNAMODB_EXPENSE_REPORT_TABLE = "   ";
        expect(() => readExpenseReportTableName()).toThrow(
            "DYNAMODB_EXPENSE_REPORT_TABLE is required.",
        );

        process.env.DYNAMODB_EXPENSE_REPORT_TABLE = "expense-reports";
        expect(readExpenseReportTableName()).toBe("expense-reports");
    });

    void test("paginates tenant cases and rolls them up by workflow stage", async () => {
        const client = {
            send: vi
                .fn()
                .mockResolvedValueOnce({
                    Items: [
                        {
                            currentStage: "Drafted",
                            dueDate: "2026-07-01",
                        },
                        {
                            currentStage: "Submitted",
                            dueDate: "2026-08-01",
                        },
                    ],
                    LastEvaluatedKey: { tenantId: "synthetic-tenant" },
                })
                .mockResolvedValueOnce({
                    Items: [
                        {
                            currentStage: "Drafted",
                            dueDate: "2026-07-15",
                        },
                    ],
                }),
        };
        const store = createDynamoExpenseReportCaseStore(
            client as never,
            "expense-reports",
        );

        const rollups = await store.readCaseQueueStageRollups({
            asOfDate: "2026-07-22",
            tenantId: "40000000-0000-4000-8000-000000000200",
        });

        expect(client.send).toHaveBeenCalledTimes(2);
        expect(rollups).toContainEqual({
            currentStage: "Drafted",
            overdueCount: 2,
            reportCount: 2,
        });
        expect(rollups).toContainEqual({
            currentStage: "Submitted",
            overdueCount: 0,
            reportCount: 1,
        });
        expect(rollups).toContainEqual({
            currentStage: "Reconciled",
            overdueCount: 0,
            reportCount: 0,
        });
    });

    void test("treats a page without items as empty", async () => {
        const client = {
            send: vi.fn().mockResolvedValue({}),
        };
        const store = createDynamoExpenseReportCaseStore(
            client as never,
            "expense-reports",
        );

        const rollups = await store.readCaseQueueStageRollups({
            asOfDate: "2026-07-22",
            tenantId: "40000000-0000-4000-8000-000000000200",
        });

        expect(rollups.every((rollup) => rollup.reportCount === 0)).toBe(true);
    });
});
