import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import {
    expenseReport,
    stageTransitionProjection,
} from "../db/schema/expenseReport.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import type { ExpenseReportStageTransitionedCloudEventV1 } from "./expenseReportStageTransitioned.v1.js";

vi.mock("../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(client);
    return { db };
});

import { db } from "../db/client.js";
import { projectStageTransition } from "./stageTransitionProjectionRepository.js";

function buildSyntheticEvent(
    tenantId: string,
    expenseReportId: string,
    stages: {
        from: ExpenseReportStageTransitionedCloudEventV1["data"]["fromStage"];
        to: ExpenseReportStageTransitionedCloudEventV1["data"]["toStage"];
    } = {
        from: "Submitted",
        to: "Manager Approval",
    },
): ExpenseReportStageTransitionedCloudEventV1 {
    const eventId = randomUUID();
    const correlationId = randomUUID();

    return {
        specversion: "1.0",
        type: "com.expenseflow.expense-report.stage-transitioned.v1",
        source: "urn:expenseflow:core-case-service",
        id: eventId,
        time: "2026-07-30T15:00:00.000Z",
        subject: `expense-reports/${expenseReportId}`,
        datacontenttype: "application/json",
        dataschema:
            "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
        correlationid: correlationId,
        data: {
            caseId: expenseReportId,
            tenantId,
            fromStage: stages.from,
            toStage: stages.to,
            correlationId,
        },
    };
}

async function insertSyntheticExpenseReport(
    tenantId: string,
    expenseReportId: string,
): Promise<void> {
    await db.insert(expenseReport).values({
        id: expenseReportId,
        tenantId,
        owner: randomUUID(),
        dueDate: "2026-08-15",
    });
}

void describe("stage-transition projection repository", () => {
    void test("persists an event once when SQS redelivers it", async () => {
        const tenantId = randomUUID();
        const expenseReportId = randomUUID();
        const syntheticEvent = buildSyntheticEvent(tenantId, expenseReportId);
        await insertSyntheticExpenseReport(tenantId, expenseReportId);

        await projectStageTransition(syntheticEvent);
        await projectStageTransition(syntheticEvent);

        const rows = await db
            .select()
            .from(stageTransitionProjection)
            .where(eq(stageTransitionProjection.eventId, syntheticEvent.id));

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            eventId: syntheticEvent.id,
            tenantId,
            expenseReportId,
            correlationId: syntheticEvent.data.correlationId,
            previousStage: "Submitted",
            currentStage: "Manager Approval",
            transitionedAt: new Date(syntheticEvent.time),
        });
    });

    void test("rejects a projection associated with another tenant's report", async () => {
        const owningTenantId = randomUUID();
        const eventTenantId = randomUUID();
        const expenseReportId = randomUUID();
        await insertSyntheticExpenseReport(owningTenantId, expenseReportId);

        await expect(
            projectStageTransition(
                buildSyntheticEvent(eventTenantId, expenseReportId),
            ),
        ).rejects.toThrow();
    });

    void test("rejects a projection with an invalid workflow edge", async () => {
        const tenantId = randomUUID();
        const expenseReportId = randomUUID();
        await insertSyntheticExpenseReport(tenantId, expenseReportId);

        await expect(
            projectStageTransition(
                buildSyntheticEvent(tenantId, expenseReportId, {
                    from: "Drafted",
                    to: "Paid",
                }),
            ),
        ).rejects.toThrow();
    });

    void test("persists the settlement compensation edge", async () => {
        const tenantId = randomUUID();
        const expenseReportId = randomUUID();
        const syntheticEvent = buildSyntheticEvent(tenantId, expenseReportId, {
            from: "Paid",
            to: "AP Review",
        });
        await insertSyntheticExpenseReport(tenantId, expenseReportId);

        await projectStageTransition(syntheticEvent);

        const rows = await db
            .select()
            .from(stageTransitionProjection)
            .where(eq(stageTransitionProjection.eventId, syntheticEvent.id));

        expect(rows).toContainEqual(
            expect.objectContaining({
                eventId: syntheticEvent.id,
                tenantId,
                expenseReportId,
                previousStage: "Paid",
                currentStage: "AP Review",
            }),
        );
    });
});
