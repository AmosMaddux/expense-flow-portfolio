import { describe, expect, test, vi } from "vitest";

import type { StageTransitionProjectionStore } from "./stageTransitionProjectionRepository.js";
import { processStageTransitionEventBody } from "./stageTransitionEventProcessor.js";

const syntheticEvent = {
    specversion: "1.0",
    type: "com.expenseflow.expense-report.stage-transitioned.v1",
    source: "urn:expenseflow:core-case-service",
    id: "40000000-0000-4000-8000-000000000021",
    time: "2026-07-30T14:00:00.000Z",
    subject: "expense-reports/30000000-0000-4000-8000-000000000021",
    datacontenttype: "application/json",
    dataschema:
        "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
    correlationid: "50000000-0000-4000-8000-000000000021",
    data: {
        caseId: "30000000-0000-4000-8000-000000000021",
        tenantId: "10000000-0000-4000-8000-000000000021",
        fromStage: "Submitted",
        toStage: "Manager Approval",
        correlationId: "50000000-0000-4000-8000-000000000021",
    },
};

function createStore(): StageTransitionProjectionStore & {
    project: ReturnType<typeof vi.fn>;
} {
    return {
        project: vi.fn().mockResolvedValue(undefined),
    };
}

void describe("stage-transition event processor", () => {
    void test("validates and projects one SQS event body", async () => {
        const store = createStore();

        const event = await processStageTransitionEventBody(
            JSON.stringify(syntheticEvent),
            store,
        );

        expect(event).toStrictEqual(syntheticEvent);
        expect(store.project).toHaveBeenCalledExactlyOnceWith(syntheticEvent);
    });

    void test("rejects malformed events without updating the projection", async () => {
        const store = createStore();

        await expect(
            processStageTransitionEventBody(
                JSON.stringify({
                    ...syntheticEvent,
                    data: {
                        ...syntheticEvent.data,
                        tenantId: "not-a-tenant-id",
                    },
                }),
                store,
            ),
        ).rejects.toThrow();
        expect(store.project).not.toHaveBeenCalled();
    });
});
