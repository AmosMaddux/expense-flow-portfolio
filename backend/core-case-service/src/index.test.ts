import { describe, expect, test } from "vitest";

import { loadExpenseReportSummary } from "./index.js";

void describe("loadExpenseReportSummary", () => {
    void test("returns the summary when Promise-based I/O succeeds", async () => {
        const mockSuccessMessage =
            "Expense Report erpt_synthetic_001 is Submitted";
        let fetchCallCount = 0;
        const fetchSummary = (): Promise<string> => {
            fetchCallCount += 1;
            return Promise.resolve(mockSuccessMessage);
        };

        const result = await loadExpenseReportSummary(fetchSummary);

        expect(result).toBe(mockSuccessMessage);
        expect(fetchCallCount).toBe(1);
    });

    void test("throws a handled error when Promise-based I/O fails", async () => {
        const mockError = new Error("case store unavailable");
        let fetchCallCount = 0;
        const fetchSummary = (): Promise<string> => {
            fetchCallCount += 1;
            return Promise.reject(mockError);
        };
        const expectedWrappedMessage =
            "Unable to load Expense Report summary: case store unavailable";

        const resultPromise = loadExpenseReportSummary(fetchSummary);

        await expect(resultPromise).rejects.toThrow(expectedWrappedMessage);
        expect(fetchCallCount).toBe(1);
    });
});
