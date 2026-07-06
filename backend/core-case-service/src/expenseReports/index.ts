/**
 * Reads the current Expense Report summary from the backing case store.
 */
export type ReadExpenseReportSummary = () => Promise<string>;

export {
    readCaseQueueStageRollups,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
} from "../db/queries/caseQueueRollups.js";

/**
 * Loads an Expense Report summary while preserving the original I/O failure as the cause.
 */
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
