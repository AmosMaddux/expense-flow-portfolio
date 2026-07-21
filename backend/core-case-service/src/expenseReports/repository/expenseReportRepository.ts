import { eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
    auditEntry,
    expenseReport,
    type ExpenseReport,
    type NewExpenseReport,
    stageTransition,
} from "../../db/schema/expenseReport.js";

export const expenseReportCreatedReason = "report_created";

/**
 * Reads an Expense Report from the case store within a tenant boundary.
 */
export async function findExpenseReportById(
    id: string,
): Promise<ExpenseReport | undefined> {
    const report: ExpenseReport[] = await db
        .select()
        .from(expenseReport)
        .where(eq(expenseReport.id, id));

    if (report.length === 1 && report[0] !== undefined) {
        return report[0];
    }

    return undefined;
}

/**
 * Creates a Drafted Expense Report with its initial audit and stage-transition rows.
 */
export async function insertDraftExpenseReport(
    tenantId: string,
    newReport: NewExpenseReport,
): Promise<ExpenseReport | undefined> {
    if (newReport.tenantId !== tenantId) {
        return undefined;
    }

    if (newReport.id !== undefined) {
        const existingReport = await findExpenseReportById(newReport.id);

        if (existingReport !== undefined) {
            if (matchesDraftCreateRequest(existingReport, newReport)) {
                return existingReport;
            }

            return undefined;
        }
    }

    return db.transaction(async (transaction) => {
        const insertedReports = await transaction
            .insert(expenseReport)
            .values({
                ...newReport,
                currentStage: "Drafted",
            })
            .returning();
        const insertedReport = insertedReports[0];

        if (insertedReport === undefined) {
            return undefined;
        }

        await transaction.insert(auditEntry).values({
            tenantId: insertedReport.tenantId,
            expenseReportId: insertedReport.id,
            actorId: insertedReport.owner,
            action: expenseReportCreatedReason,
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
        });

        await transaction.insert(stageTransition).values({
            expenseReportId: insertedReport.id,
            tenantId: insertedReport.tenantId,
            fromStage: "Drafted",
            toStage: "Drafted",
            actor: insertedReport.owner,
            reason: expenseReportCreatedReason,
        });

        return insertedReport;
    });
}

function matchesDraftCreateRequest(
    report: ExpenseReport,
    newReport: NewExpenseReport,
): boolean {
    return (
        report.tenantId === newReport.tenantId &&
        report.owner === newReport.owner &&
        report.dueDate === newReport.dueDate &&
        report.priority === (newReport.priority ?? "Normal") &&
        report.currentStage === "Drafted"
    );
}
