import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import { stageTransitionProjection } from "../db/schema/expenseReport.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";

vi.mock("../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(client);
    return { db };
});

import { db } from "../db/client.js";
import { projectStageTransition } from "./stageTransitionProjectionRepository.js";

const syntheticEvent = {
    specversion: "1.0" as const,
    type: "com.expenseflow.expense-report.stage-transitioned.v1" as const,
    source: "urn:expenseflow:core-case-service" as const,
    id: "40000000-0000-4000-8000-000000000041",
    time: "2026-07-30T15:00:00.000Z",
    subject: "expense-reports/30000000-0000-4000-8000-000000000041",
    datacontenttype: "application/json" as const,
    dataschema:
        "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1" as const,
    correlationid: "50000000-0000-4000-8000-000000000041",
    data: {
        caseId: "30000000-0000-4000-8000-000000000041",
        tenantId: "10000000-0000-4000-8000-000000000041",
        fromStage: "Submitted" as const,
        toStage: "Manager Approval" as const,
        correlationId: "50000000-0000-4000-8000-000000000041",
    },
};

void describe("stage-transition projection repository", () => {
    void test("persists an event once when SQS redelivers it", async () => {
        await projectStageTransition(syntheticEvent);
        await projectStageTransition(syntheticEvent);

        const rows = await db
            .select()
            .from(stageTransitionProjection)
            .where(eq(stageTransitionProjection.eventId, syntheticEvent.id));

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            eventId: syntheticEvent.id,
            tenantId: syntheticEvent.data.tenantId,
            expenseReportId: syntheticEvent.data.caseId,
            correlationId: syntheticEvent.data.correlationId,
            previousStage: "Submitted",
            currentStage: "Manager Approval",
            transitionedAt: new Date(syntheticEvent.time),
        });
    });
});
