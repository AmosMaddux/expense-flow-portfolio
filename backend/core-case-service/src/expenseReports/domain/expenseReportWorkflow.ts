import type { approvedWorkflowStages } from "../../db/schema/index.js";

export type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

export const expenseReportWorkflowEdges = [
    ["Drafted", "Submitted"],
    ["Submitted", "Manager Approval"],
    ["Manager Approval", "AP Review"],
    ["AP Review", "Paid"],
    ["Paid", "Reconciled"],
    ["Manager Approval", "Drafted"],
    ["AP Review", "Drafted"],
] as const satisfies ReadonlyArray<
    readonly [ExpenseReportStage, ExpenseReportStage]
>;

const expenseReportWorkflowEdgeKeys = new Set(
    expenseReportWorkflowEdges.map(
        ([fromStage, toStage]) => `${fromStage}->${toStage}`,
    ),
);

/**
 * Returns whether two stages form an allowed Expense Report workflow edge.
 */
export function isExpenseReportWorkflowEdge(
    fromStage: ExpenseReportStage,
    toStage: ExpenseReportStage,
): boolean {
    return expenseReportWorkflowEdgeKeys.has(`${fromStage}->${toStage}`);
}
