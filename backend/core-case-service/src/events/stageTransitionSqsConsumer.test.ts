import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { describe, expect, test, vi } from "vitest";

import type { StageTransitionProjectionStore } from "./stageTransitionProjectionRepository.js";
import { pollStageTransitionQueueOnce } from "./stageTransitionSqsConsumer.js";

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
        const messageFailed = vi.fn();

        const result = await pollStageTransitionQueueOnce({ send }, config, {
            logger: { messageFailed },
            store,
        });

        expect(result).toStrictEqual({ failed: 1, processed: 0 });
        expect(store.project).not.toHaveBeenCalled();
        expect(messageFailed).toHaveBeenCalledOnce();
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
        const messageFailed = vi.fn();

        const result = await pollStageTransitionQueueOnce({ send }, config, {
            logger: { messageFailed },
            store,
        });

        expect(result).toStrictEqual({ failed: 1, processed: 0 });
        expect(store.project).toHaveBeenCalledOnce();
        expect(messageFailed).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
    });
});
