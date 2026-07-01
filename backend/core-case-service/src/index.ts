export type ReadExpenseReportSummary = () => Promise<string>;

export async function loadExpenseReportSummary(
    readExpenseReportSummary: ReadExpenseReportSummary,
): Promise<string> {
    try {
        return await readExpenseReportSummary();
    } catch (error: unknown) {
        const message =
            error instanceof Error ? error.message : "unknown error";

        throw new Error(`Unable to load Expense Report summary: ${message}`, {
            cause: error,
        });
    }
}
