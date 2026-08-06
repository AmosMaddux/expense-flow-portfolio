import { describe, expect, test } from "vitest";

import {
    EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA,
    EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
    ExpenseReportStageTransitionedCloudEventV1Schema,
    type ExpenseReportStageTransitionedCloudEventV1,
} from "./expenseReportStageTransitioned.v1.js";

const syntheticStageTransitionEvent = {
    specversion: "1.0",
    type: EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
    source: "urn:expenseflow:core-case-service",
    id: "40000000-0000-4000-8000-000000000001",
    time: "2026-07-29T15:30:00.000Z",
    subject: "expense-reports/30000000-0000-4000-8000-000000000001",
    datacontenttype: "application/json",
    dataschema: EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA,
    correlationid: "50000000-0000-4000-8000-000000000001",
    data: {
        caseId: "30000000-0000-4000-8000-000000000001",
        tenantId: "10000000-0000-4000-8000-000000000100",
        fromStage: "Submitted",
        toStage: "Manager Approval",
        correlationId: "50000000-0000-4000-8000-000000000001",
    },
} as const;

void describe("ExpenseReportStageTransitionedCloudEventV1Schema", () => {
    void test("validates a version 1 stage-transition sample event", () => {
        const parsed: ExpenseReportStageTransitionedCloudEventV1 =
            ExpenseReportStageTransitionedCloudEventV1Schema.parse(
                syntheticStageTransitionEvent,
            );

        expect(parsed).toStrictEqual(syntheticStageTransitionEvent);
    });

    void test("validates the settlement compensation edge", () => {
        const parsed = ExpenseReportStageTransitionedCloudEventV1Schema.parse({
            ...syntheticStageTransitionEvent,
            data: {
                ...syntheticStageTransitionEvent.data,
                fromStage: "Paid",
                toStage: "AP Review",
            },
        });

        expect(parsed.data.fromStage).toBe("Paid");
        expect(parsed.data.toStage).toBe("AP Review");
    });

    void test("rejects an event with inconsistent correlation identifiers", () => {
        const result =
            ExpenseReportStageTransitionedCloudEventV1Schema.safeParse({
                ...syntheticStageTransitionEvent,
                correlationid: "50000000-0000-4000-8000-000000000002",
            });

        expect(result.success).toBe(false);
    });

    void test("rejects an event missing tenant scope", () => {
        const dataWithoutTenant: Record<string, unknown> = {
            ...syntheticStageTransitionEvent.data,
        };
        delete dataWithoutTenant.tenantId;
        const result =
            ExpenseReportStageTransitionedCloudEventV1Schema.safeParse({
                ...syntheticStageTransitionEvent,
                data: dataWithoutTenant,
            });

        expect(result.success).toBe(false);
    });

    void test("rejects a structurally valid but impossible workflow edge", () => {
        const result =
            ExpenseReportStageTransitionedCloudEventV1Schema.safeParse({
                ...syntheticStageTransitionEvent,
                data: {
                    ...syntheticStageTransitionEvent.data,
                    fromStage: "Paid",
                    toStage: "Submitted",
                },
            });

        expect(result.success).toBe(false);
    });
});
