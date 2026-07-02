import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import { expenseReport } from "../schema/index.js";
import { readCaseQueueStageRollups } from "./caseQueueRollups.js";

const tenantOneId = "10000000-0000-4000-8000-000000000100";
const tenantTwoId = "99900000-0000-4000-8000-000000000999";
const ownerId = "20000000-0000-4000-8000-000000000001";
let syntheticReportSequence = 0;

type TestDatabase = PgliteDatabase<Record<string, never>> & {
    $client: PGlite;
};

async function createExpenseReportTable(db: TestDatabase): Promise<void> {
    await db.execute(sql`
        create table "expense_report" (
            "id" uuid primary key not null,
            "current_stage" text default 'Drafted' not null,
            "on_hold" boolean default false not null,
            "hold_reason" text,
            "owner" uuid not null,
            "priority" text default 'Normal' not null,
            "due_date" date not null,
            "tenant_id" uuid not null,
            "created_at" timestamp with time zone default now() not null,
            "updated_at" timestamp with time zone default now() not null
        )
    `);
}

function buildExpenseReportValues(
    tenantId: string,
    currentStage: string,
    reportCount: number,
    dueDate: string,
): Array<typeof expenseReport.$inferInsert> {
    return Array.from({ length: reportCount }, () => {
        syntheticReportSequence += 1;

        return {
            id: `30000000-0000-4000-8000-${String(syntheticReportSequence).padStart(12, "0")}`,
            currentStage,
            dueDate,
            owner: ownerId,
            tenantId,
        };
    });
}

void describe("readCaseQueueStageRollups", () => {
    const client = new PGlite();
    const db = drizzle(client);

    before(async () => {
        await createExpenseReportTable(db);

        await db
            .insert(expenseReport)
            .values([
                ...buildExpenseReportValues(
                    tenantOneId,
                    "Drafted",
                    1,
                    "2026-06-30",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "Drafted",
                    1,
                    "2026-07-02",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "AP Review",
                    2,
                    "2026-06-30",
                ),
                ...buildExpenseReportValues(
                    tenantOneId,
                    "AP Review",
                    3,
                    "2026-07-02",
                ),
                ...buildExpenseReportValues(
                    tenantTwoId,
                    "Submitted",
                    3,
                    "2026-06-30",
                ),
            ]);
    });

    after(async () => {
        await client.close();
    });

    void test("returns tenant-scoped counts for every workflow stage", async () => {
        const rollups = await readCaseQueueStageRollups(db, {
            tenantId: tenantOneId,
            asOfDate: "2026-07-01",
        });

        assert.deepEqual(rollups, [
            {
                currentStage: "Drafted",
                reportCount: 2,
                overdueCount: 1,
            },
            {
                currentStage: "Submitted",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "Manager Approval",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "AP Review",
                reportCount: 5,
                overdueCount: 2,
            },
            {
                currentStage: "Paid",
                reportCount: 0,
                overdueCount: 0,
            },
            {
                currentStage: "Reconciled",
                reportCount: 0,
                overdueCount: 0,
            },
        ]);
    });
});
