import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { describe, expect, test, vi } from "vitest";

import type { StageTransitionProjectionStore } from "./stageTransitionProjectionRepository.js";
import {
    pollStageTransitionQueueOnce,
    runStageTransitionSqsConsumer,
} from "./stageTransitionSqsConsumer.js";

const config = {
    region: "us-east-1",
    queueUrl:
        "http://127.0.0.1:4566/000000000000/expenseflow-stage-transition-events",
};

const syntheticEvent = {
    specversion: "1.0",
    type: "com.expenseflow.expense-report.stage-transitioned.v1",
    source: "urn:expenseflow:core-case-service",
    id: "40000000-0000-4000-8000-000000000031",
    time: "2026-07-30T14:30:00.000Z",
    subject: "expense-reports/30000000-0000-4000-8000-000000000031",
    datacontenttype: "application/json",
    dataschema:
        "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
    correlationid: "50000000-0000-4000-8000-000000000031",
    data: {
        caseId: "30000000-0000-4000-8000-000000000031",
        tenantId: "10000000-0000-4000-8000-000000000031",
        fromStage: "Manager Approval",
        toStage: "AP Review",
        correlationId: "50000000-0000-4000-8000-000000000031",
    },
};

function createStore(): StageTransitionProjectionStore & {
    project: ReturnType<typeof vi.fn>;
} {
    return {
        project: vi.fn().mockResolvedValue(undefined),
    };
}

function createLogger() {
    return {
        messageFailed: vi.fn(),
        pollFailed: vi.fn(),
    };
}

void describe("plain stage-transition SQS consumer", () => {
    void test("projects a valid event and deletes its SQS message", async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Messages: [
                    {
                        Body: JSON.stringify(syntheticEvent),
                        ReceiptHandle: "synthetic-receipt-handle",
                    },
                ],
            })
            .mockResolvedValueOnce({});
        const store = createStore();

        const result = await pollStageTransitionQueueOnce({ send }, config, {
            store,
        });

        expect(result).toStrictEqual({ failed: 0, processed: 1 });
        expect(store.project).toHaveBeenCalledExactlyOnceWith(syntheticEvent);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ReceiveMessageCommand);
        expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteMessageCommand);
        expect(send.mock.calls[1]?.[0]).toMatchObject({
            input: {
                QueueUrl: config.queueUrl,
                ReceiptHandle: "synthetic-receipt-handle",
            },
        });
    });

    void test("retains an invalid message for SQS retry", async () => {
        const send = vi.fn().mockResolvedValue({
            Messages: [
                {
                    Body: JSON.stringify({
                        ...syntheticEvent,
                        type: "unsupported-event",
                    }),
                    ReceiptHandle: "synthetic-receipt-handle",
                },
            ],
        });
        const store = createStore();
        const logger = createLogger();

        const result = await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });

        expect(result).toStrictEqual({ failed: 1, processed: 0 });
        expect(store.project).not.toHaveBeenCalled();
        expect(logger.messageFailed).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ReceiveMessageCommand);
    });

    void test("does not delete a message when its projection write fails", async () => {
        const send = vi.fn().mockResolvedValue({
            Messages: [
                {
                    Body: JSON.stringify(syntheticEvent),
                    ReceiptHandle: "synthetic-receipt-handle",
                },
            ],
        });
        const store = createStore();
        store.project.mockRejectedValue(
            new Error("synthetic projection failure"),
        );
        const logger = createLogger();

        const result = await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });

        expect(result).toStrictEqual({ failed: 1, processed: 0 });
        expect(store.project).toHaveBeenCalledOnce();
        expect(logger.messageFailed).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
    });

    void test("retains repeated projection failures without changing persisted projection state", async () => {
        const maxReceiveCount = 3;
        const send = vi.fn().mockResolvedValue({
            Messages: [
                {
                    Attributes: {
                        ApproximateReceiveCount: "1",
                    },
                    Body: JSON.stringify(syntheticEvent),
                    ReceiptHandle: "synthetic-receipt-handle",
                },
            ],
        });
        const persistedState = {
            currentStage: "Manager Approval",
            projectionRows: new Map<string, string>(),
        };
        const store: StageTransitionProjectionStore & {
            project: ReturnType<typeof vi.fn>;
        } = {
            project: vi.fn(async (event: typeof syntheticEvent) => {
                await Promise.resolve();
                persistedState.projectionRows.set(event.id, event.data.toStage);
                persistedState.currentStage = event.data.toStage;
            }),
        };
        store.project.mockRejectedValue(
            new Error("synthetic projection failure"),
        );
        const logger = createLogger();

        for (let attempt = 0; attempt < maxReceiveCount; attempt += 1) {
            const result = await pollStageTransitionQueueOnce(
                { send },
                config,
                {
                    logger,
                    store,
                },
            );

            expect(result).toStrictEqual({ failed: 1, processed: 0 });
        }

        expect(persistedState.currentStage).toBe("Manager Approval");
        expect(persistedState.projectionRows.size).toBe(0);
        expect(store.project).toHaveBeenCalledTimes(maxReceiveCount);
        expect(logger.messageFailed).toHaveBeenCalledTimes(maxReceiveCount);
        expect(send).toHaveBeenCalledTimes(maxReceiveCount);
        expect(
            send.mock.calls.some(
                ([command]) => command instanceof DeleteMessageCommand,
            ),
        ).toBe(false);
        expect(send.mock.calls[0]?.[0]).toMatchObject({
            input: {
                MessageSystemAttributeNames: ["ApproximateReceiveCount"],
            },
        });
    });

    void test("backs off and keeps polling after a receive failure", async () => {
        const shutdownController = new AbortController();
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error("synthetic SQS failure"))
            .mockImplementationOnce(() => {
                shutdownController.abort();
                return Promise.resolve({ Messages: [] });
            });
        const logger = createLogger();
        const waitForRetry = vi
            .fn<
                (
                    delayMilliseconds: number,
                    signal: AbortSignal,
                ) => Promise<void>
            >()
            .mockResolvedValue(undefined);

        await runStageTransitionSqsConsumer(
            { send },
            config,
            shutdownController.signal,
            {
                logger,
                store: createStore(),
                waitForRetry,
            },
        );

        expect(send).toHaveBeenCalledTimes(2);
        expect(logger.pollFailed).toHaveBeenCalledExactlyOnceWith(
            "receive_failed",
        );
        expect(waitForRetry).toHaveBeenCalledExactlyOnceWith(
            1_000,
            shutdownController.signal,
        );
    });

    void test("caps exponential poll backoff at thirty seconds", async () => {
        const shutdownController = new AbortController();
        let receiveAttempt = 0;
        const send = vi.fn().mockImplementation(() => {
            receiveAttempt += 1;
            if (receiveAttempt <= 7) {
                return Promise.reject(new Error("synthetic SQS failure"));
            }

            shutdownController.abort();
            return Promise.resolve({ Messages: [] });
        });
        const waitForRetry = vi
            .fn<
                (
                    delayMilliseconds: number,
                    signal: AbortSignal,
                ) => Promise<void>
            >()
            .mockResolvedValue(undefined);

        await runStageTransitionSqsConsumer(
            { send },
            config,
            shutdownController.signal,
            {
                logger: createLogger(),
                store: createStore(),
                waitForRetry,
            },
        );

        expect(waitForRetry.mock.calls.map(([delay]) => delay)).toStrictEqual([
            1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
        ]);
    });
});
