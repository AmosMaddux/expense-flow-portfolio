import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadStageTransitionEventsConfig } from "./stageTransitionEventsConfig.js";

void describe("stage-transition event configuration", () => {
    void test("loads a valid SNS topic configuration", () => {
        expect(
            loadStageTransitionEventsConfig({
                AWS_REGION: "us-east-1",
                STAGE_TRANSITION_SNS_ENDPOINT: "http://127.0.0.1:4566",
                STAGE_TRANSITION_SNS_TOPIC_ARN:
                    "arn:aws:sns:us-east-1:000000000000:expenseflow-stage-transitions",
            }),
        ).toStrictEqual({
            endpoint: "http://127.0.0.1:4566",
            region: "us-east-1",
            topicArn:
                "arn:aws:sns:us-east-1:000000000000:expenseflow-stage-transitions",
        });
    });

    void test("rejects missing SNS configuration", () => {
        expect(() =>
            loadStageTransitionEventsConfig({
                AWS_REGION: "us-east-1",
            }),
        ).toThrow(ConfigurationError);
    });
});
