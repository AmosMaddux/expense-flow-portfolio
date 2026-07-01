import { describe, expect, test } from "vitest";

import { loadExpenseReportSummary } from "./index.js";

void describe("loadExpenseReportSummary", () => {
    void test("returns the summary when Promise-based I/O succeeds", async () => {
        // Arrange
        const mockSuccessMessage =
            "Expense Report erpt_synthetic_001 is Submitted";
        let fetchCallCount = 0;
        const fetchSummary = (): Promise<string> => {
            fetchCallCount += 1;
            return Promise.resolve(mockSuccessMessage);
        };

        // Act
        const result = await loadExpenseReportSummary(fetchSummary);

        // Assert
        expect(result).toBe(mockSuccessMessage);
        expect(fetchCallCount).toBe(1);
    });

    void test("throws a handled error when Promise-based I/O fails", async () => {
        // Arrange
        const mockError = new Error("case store unavailable");
        let fetchCallCount = 0;
        const fetchSummary = (): Promise<string> => {
            fetchCallCount += 1;
            return Promise.reject(mockError);
        };
        const expectedWrappedMessage =
            "Unable to load Expense Report summary: case store unavailable";

        // Act
        const resultPromise = loadExpenseReportSummary(fetchSummary);

        // Assert
        await expect(resultPromise).rejects.toThrow(expectedWrappedMessage);
        expect(fetchCallCount).toBe(1);
    });
});
