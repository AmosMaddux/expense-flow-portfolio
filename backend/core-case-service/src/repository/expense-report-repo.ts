import { db } from "../db/client.js";
import {
    expenseReport,
    ExpenseReport,
    NewExpenseReport,
} from "../db/schema/expenseReport.js";
import { eq, and } from "drizzle-orm";
import { None, Results, Some } from "./repo-common.js";

export async function getExpenseReport(
    id: string,
    tenant_id: string,
): Promise<Results<ExpenseReport>> {
    const report: ExpenseReport[] = await db
        .select()
        .from(expenseReport)
        .where(
            and(
                eq(expenseReport.id, id),
                eq(expenseReport.tenantId, tenant_id),
            ),
        );

    if (report.length == 1 && report[0] !== undefined) {
        return Some(report[0]);
    } else {
        return None();
    }
}

export async function newExpenseReport(
    tenant_id: string,
    new_report: NewExpenseReport,
): Promise<Results<ExpenseReport>> {
    // require the submitted report to have the same tenant id
    if (new_report.tenantId != tenant_id) {
        return None();
    }

    const inserted_record = await db
        .insert(expenseReport)
        .values(new_report)
        .returning();

    if (inserted_record.length == 1 && inserted_record[0] !== undefined) {
        return Some(inserted_record[0]);
    } else {
        return None();
    }
}
