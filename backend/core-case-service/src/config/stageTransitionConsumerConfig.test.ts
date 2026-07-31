import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadStageTransitionConsumerConfig } from "./stageTransitionConsumerConfig.js";

void describe("stage-transition consumer configuration", () => {
    void test("loads a valid SQS queue configuration", () => {
        expect(
            loadStageTransitionConsumerConfig({
                AWS_REGION: "us-east-1",
                STAGE_TRANSITION_SQS_ENDPOINT: "http://127.0.0.1:4566",
                STAGE_TRANSITION_SQS_QUEUE_URL:
                    "http://127.0.0.1:4566/000000000000/expenseflow-stage-transition-events",
            }),
        ).toStrictEqual({
            endpoint: "http://127.0.0.1:4566",
            queueUrl:
                "http://127.0.0.1:4566/000000000000/expenseflow-stage-transition-events",
            region: "us-east-1",
        });
    });

    void test("rejects missing SQS configuration", () => {
        expect(() =>
            loadStageTransitionConsumerConfig({
                AWS_REGION: "us-east-1",
            }),
        ).toThrow(ConfigurationError);
    });
});
