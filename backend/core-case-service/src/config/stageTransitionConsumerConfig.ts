import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const stageTransitionConsumerConfigSchema = z.object({
    AWS_REGION: z.string().trim().min(1),
    STAGE_TRANSITION_SQS_ENDPOINT: z.url().optional(),
    STAGE_TRANSITION_SQS_QUEUE_URL: z.url(),
});

export type StageTransitionConsumerConfig = {
    endpoint?: string;
    queueUrl: string;
    region: string;
};

/**
 * Loads the SQS configuration used by the stage-transition projection consumer.
 */
export function loadStageTransitionConsumerConfig(
    environment: NodeJS.ProcessEnv = process.env,
): StageTransitionConsumerConfig {
    const parsed = stageTransitionConsumerConfigSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Stage-transition event consumption is not configured.",
            { cause: parsed.error },
        );
    }

    return {
        ...(parsed.data.STAGE_TRANSITION_SQS_ENDPOINT === undefined
            ? {}
            : { endpoint: parsed.data.STAGE_TRANSITION_SQS_ENDPOINT }),
        queueUrl: parsed.data.STAGE_TRANSITION_SQS_QUEUE_URL,
        region: parsed.data.AWS_REGION,
    };
}
