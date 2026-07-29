import { describe, expect, test, vi } from "vitest";

import { BadGatewayError } from "../errors/problem-json.js";
import { ExpenseReportStageTransitionedCloudEventV1Schema } from "./expenseReportStageTransitioned.v1.js";
import { createSnsStageTransitionEventPublisher } from "./stageTransitionEventPublisher.js";

const request = {
    caseId: "30000000-0000-4000-8000-000000000001",
    tenantId: "10000000-0000-4000-8000-000000000100",
    fromStage: "Submitted" as const,
    toStage: "Manager Approval" as const,
    correlationId: "50000000-0000-4000-8000-000000000001",
};

const config = {
    region: "us-east-1",
    topicArn:
        "arn:aws:sns:us-east-1:000000000000:expenseflow-stage-transitions",
};

void describe("SNS stage-transition event publisher", () => {
    void test("publishes one validated event with its correlation id", async () => {
        const send = vi.fn().mockResolvedValue({ MessageId: "synthetic-id" });
        const publisher = createSnsStageTransitionEventPublisher(
            { send },
            config,
            () => new Date("2026-07-29T15:30:00.000Z"),
            () => "40000000-0000-4000-8000-000000000001",
        );

        await publisher.publish(request);

        expect(send).toHaveBeenCalledTimes(1);
        const command = send.mock.calls[0]?.[0] as {
            input: {
                Message?: string;
                MessageAttributes?: Record<
                    string,
                    { DataType?: string; StringValue?: string }
                >;
                TopicArn?: string;
            };
        };
        const event = ExpenseReportStageTransitionedCloudEventV1Schema.parse(
            JSON.parse(command.input.Message ?? "") as unknown,
        );

        expect(command.input.TopicArn).toBe(config.topicArn);
        expect(command.input.MessageAttributes?.correlationId).toStrictEqual({
            DataType: "String",
            StringValue: request.correlationId,
        });
        expect(event).toMatchObject({
            correlationid: request.correlationId,
            data: request,
        });
    });

    void test("surfaces SNS rejection as a backend downstream error", async () => {
        const send = vi.fn().mockRejectedValue(new Error("synthetic failure"));
        const publisher = createSnsStageTransitionEventPublisher(
            { send },
            config,
        );

        await expect(publisher.publish(request)).rejects.toBeInstanceOf(
            BadGatewayError,
        );
        expect(send).toHaveBeenCalledTimes(1);
    });
});
