import { describe, expect, it } from "vitest";

import { loadExpenseReportSummary } from "./index.js";

describe("loadExpenseReportSummary", () => {
    it("returns the summary when Promise-based I/O succeeds", async () => {
        const result = await loadExpenseReportSummary(
            async () => "Expense Report erpt_synthetic_001 is Submitted",
        );

        expect(result).toBe("Expense Report erpt_synthetic_001 is Submitted");
    });

    it("throws a handled error when Promise-based I/O fails", async () => {
        await expect(
            loadExpenseReportSummary(async () => {
                throw new Error("case store unavailable");
            }),
        ).rejects.toThrow(
            "Unable to load Expense Report summary: case store unavailable",
        );
    });
});
