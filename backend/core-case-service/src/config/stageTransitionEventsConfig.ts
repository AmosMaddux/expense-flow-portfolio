import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const stageTransitionEventsConfigSchema = z.object({
    AWS_REGION: z.string().trim().min(1),
    STAGE_TRANSITION_SNS_ENDPOINT: z.url().optional(),
    STAGE_TRANSITION_SNS_TOPIC_ARN: z
        .string()
        .trim()
        .regex(/^arn:[^:]+:sns:[^:]+:[^:]+:[^:]+$/),
});

export type StageTransitionEventsConfig = {
    endpoint?: string;
    region: string;
    topicArn: string;
};

/**
 * Loads the SNS configuration used for Expense Report stage-transition events.
 */
export function loadStageTransitionEventsConfig(
    environment: NodeJS.ProcessEnv = process.env,
): StageTransitionEventsConfig {
    const parsed = stageTransitionEventsConfigSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Stage-transition event publishing is not configured.",
            { cause: parsed.error },
        );
    }

    return {
        ...(parsed.data.STAGE_TRANSITION_SNS_ENDPOINT === undefined
            ? {}
            : { endpoint: parsed.data.STAGE_TRANSITION_SNS_ENDPOINT }),
        region: parsed.data.AWS_REGION,
        topicArn: parsed.data.STAGE_TRANSITION_SNS_TOPIC_ARN,
    };
}
