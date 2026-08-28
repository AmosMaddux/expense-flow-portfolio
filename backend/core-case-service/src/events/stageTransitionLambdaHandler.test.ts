import { afterEach, describe, expect, test, vi } from "vitest";

import { createStageTransitionLambdaHandler } from "./stageTransitionLambdaHandler.js";

const syntheticEvent = {
    specversion: "1.0",
    type: "com.expenseflow.expense-report.stage-transitioned.v1",
    source: "urn:expenseflow:core-case-service",
    id: "40000000-0000-4000-8000-000000000149",
    time: "2026-08-11T14:30:00.000Z",
    subject: "expense-reports/30000000-0000-4000-8000-000000000149",
    datacontenttype: "application/json",
    dataschema:
        "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
    correlationid: "50000000-0000-4000-8000-000000000149",
    data: {
        caseId: "30000000-0000-4000-8000-000000000149",
        tenantId: "10000000-0000-4000-8000-000000000149",
        fromStage: "Submitted",
        toStage: "Manager Approval",
        correlationId: "50000000-0000-4000-8000-000000000149",
    },
};

function buildSqsEvent(records: Array<{ body: string; messageId: string }>) {
    return {
        Records: records,
    };
}

function createLogger() {
    return {
        recordFailed: vi.fn(),
    };
}

void describe("stage-transition Lambda handler", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    void test("projects a valid SQS record and returns no batch failures", async () => {
        const processEventBody = vi.fn().mockResolvedValue(undefined);
        const handler = createStageTransitionLambdaHandler({
            processEventBody,
        });

        const response = await handler(
            buildSqsEvent([
                {
                    body: JSON.stringify(syntheticEvent),
                    messageId: "synthetic-message-1",
                },
            ]),
        );

        expect(response).toStrictEqual({ batchItemFailures: [] });
        expect(processEventBody).toHaveBeenCalledExactlyOnceWith(
            JSON.stringify(syntheticEvent),
        );
    });

    void test("returns a failed item when projection rejects", async () => {
        const logger = createLogger();
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const processEventBody = vi
            .fn()
            .mockRejectedValue(new Error("synthetic projection failure"));
        const handler = createStageTransitionLambdaHandler({
            logger,
            processEventBody,
        });

        const response = await handler(
            buildSqsEvent([
                {
                    body: JSON.stringify(syntheticEvent),
                    messageId: "synthetic-message-1",
                },
            ]),
        );

        expect(response).toStrictEqual({
            batchItemFailures: [
                {
                    itemIdentifier: "synthetic-message-1",
                },
            ],
        });
        expect(logger.recordFailed).toHaveBeenCalledOnce();
        expect(consoleError).toHaveBeenCalledWith(
            JSON.stringify({
                environment: "sandbox",
                errorName: "StageTransitionConsumerRecordFailure",
                eventType: "stage_transition_consumer",
                metricName: "StageTransitionConsumerErrorCount",
                metricValue: 1,
                outcome: "error",
                service: "stage-transition-consumer-lambda",
                tenantId: syntheticEvent.data.tenantId,
            }),
        );
        expect(consoleError).not.toHaveBeenCalledWith(
            expect.stringContaining("synthetic-message-1"),
        );
    });

    void test("returns only failed records from a mixed batch", async () => {
        const logger = createLogger();
        const processEventBody = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("synthetic validation failure"))
            .mockResolvedValueOnce(undefined);
        const handler = createStageTransitionLambdaHandler({
            logger,
            processEventBody,
        });

        const response = await handler(
            buildSqsEvent([
                {
                    body: JSON.stringify(syntheticEvent),
                    messageId: "synthetic-message-1",
                },
                {
                    body: "not-json",
                    messageId: "synthetic-message-2",
                },
                {
                    body: JSON.stringify({
                        ...syntheticEvent,
                        id: "40000000-0000-4000-8000-000000000150",
                    }),
                    messageId: "synthetic-message-3",
                },
            ]),
        );

        expect(response).toStrictEqual({
            batchItemFailures: [
                {
                    itemIdentifier: "synthetic-message-2",
                },
            ],
        });
        expect(processEventBody).toHaveBeenCalledTimes(3);
        expect(logger.recordFailed).toHaveBeenCalledOnce();
    });

    void test("uses an injected processor without verifying the database URL", async () => {
        const verifyDatabaseUrl = vi.fn().mockResolvedValue(undefined);
        const processEventBody = vi.fn().mockResolvedValue(undefined);
        const handler = createStageTransitionLambdaHandler({
            verifyDatabaseUrl,
            processEventBody,
        });

        await handler(
            buildSqsEvent([
                {
                    body: JSON.stringify(syntheticEvent),
                    messageId: "synthetic-message-1",
                },
            ]),
        );

        expect(verifyDatabaseUrl).not.toHaveBeenCalled();
        expect(processEventBody).toHaveBeenCalledOnce();
    });

    void test("reports malformed SQS records as parse failures", async () => {
        const handler = createStageTransitionLambdaHandler({
            processEventBody: vi.fn().mockResolvedValue(undefined),
        });

        await expect(
            handler({
                Records: [
                    {
                        body: "",
                        messageId: "synthetic-message-1",
                    },
                ],
            }),
        ).rejects.toThrow();
    });
});
