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

    void test("redrives repeated consumer failures to the DLQ without changing case state", async () => {
        const maxReceiveCount = 3;
        const receiptHandle = "synthetic-receipt-handle";
        const mainMessages = [
            {
                Body: JSON.stringify(syntheticEvent),
                ReceiptHandle: receiptHandle,
                receiveCount: 0,
            },
        ];
        const dlqMessages: typeof mainMessages = [];
        const send = vi.fn().mockImplementation((command) => {
            if (command instanceof DeleteMessageCommand) {
                mainMessages.splice(0, mainMessages.length);
                return Promise.resolve({});
            }

            const message = mainMessages[0];
            if (message === undefined) {
                return Promise.resolve({ Messages: [] });
            }

            message.receiveCount += 1;
            if (message.receiveCount > maxReceiveCount) {
                dlqMessages.push(message);
                mainMessages.splice(0, mainMessages.length);
                return Promise.resolve({ Messages: [] });
            }

            return Promise.resolve({
                Messages: [
                    {
                        Body: message.Body,
                        ReceiptHandle: message.ReceiptHandle,
                    },
                ],
            });
        });
        const caseState = {
            currentStage: "Manager Approval",
            projectionRows: 0,
        };
        const store = createStore();
        store.project.mockRejectedValue(
            new Error("synthetic projection failure"),
        );
        const logger = createLogger();

        await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });
        await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });
        await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });
        await pollStageTransitionQueueOnce({ send }, config, {
            logger,
            store,
        });

        expect(dlqMessages).toHaveLength(1);
        expect(dlqMessages[0]?.Body).toBe(JSON.stringify(syntheticEvent));
        expect(caseState).toStrictEqual({
            currentStage: "Manager Approval",
            projectionRows: 0,
        });
        expect(store.project).toHaveBeenCalledTimes(maxReceiveCount);
        expect(logger.messageFailed).toHaveBeenCalledTimes(maxReceiveCount);
        expect(send.mock.calls).toHaveLength(maxReceiveCount + 1);
        expect(
            send.mock.calls.some(
                ([command]) => command instanceof DeleteMessageCommand,
            ),
        ).toBe(false);
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
