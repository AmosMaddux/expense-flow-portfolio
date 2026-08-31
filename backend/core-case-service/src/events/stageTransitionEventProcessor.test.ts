import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StageTransitionProjectionStore } from "./stageTransitionProjectionRepository.js";
import { processStageTransitionEventBody } from "./stageTransitionEventProcessor.js";

const logCoreCaseMetricMock = vi.hoisted(() => vi.fn());

vi.mock("../logging/coreCaseLogger.js", () => ({
    logCoreCaseMetric: logCoreCaseMetricMock,
}));

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

function createStore(): {
    project: ReturnType<
        typeof vi.fn<StageTransitionProjectionStore["project"]>
    >;
    store: StageTransitionProjectionStore;
} {
    const project = vi
        .fn<StageTransitionProjectionStore["project"]>()
        .mockResolvedValue(undefined);
    return {
        project,
        store: { project },
    };
}

void describe("stage-transition event processor", () => {
    beforeEach(() => {
        logCoreCaseMetricMock.mockClear();
    });

    void test("validates and projects one SQS event body", async () => {
        const { project, store } = createStore();

        const event = await processStageTransitionEventBody(
            JSON.stringify(syntheticEvent),
            store,
        );

        expect(event).toStrictEqual(syntheticEvent);
        expect(project).toHaveBeenCalledExactlyOnceWith(syntheticEvent);
        expect(logCoreCaseMetricMock).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: "stage_transition_consumer",
                metricName: "StageTransitionConsumerSuccessCount",
                service: "stage-transition-consumer-lambda",
                tenantId: syntheticEvent.data.tenantId,
            }),
        );
    });

    void test("rejects malformed events without updating the projection", async () => {
        const { project, store } = createStore();

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
        expect(project).not.toHaveBeenCalled();
        expect(logCoreCaseMetricMock).not.toHaveBeenCalled();
    });
});
