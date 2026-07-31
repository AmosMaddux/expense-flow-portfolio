import { z } from "zod";

const StageTransitionEventsEnvironmentSchema = z.object({
    STAGE_TRANSITION_SNS_TOPIC_ARN: z.string().trim().min(1),
    STAGE_TRANSITION_SNS_ENDPOINT: z.url().optional(),
});

export type StageTransitionEventsConfig = z.infer<
    typeof StageTransitionEventsEnvironmentSchema
>;

/**
 * Reads the configured SNS target for Expense Report stage-transition events.
 */
export function loadStageTransitionEventsConfig(
    environment: NodeJS.ProcessEnv = process.env,
): StageTransitionEventsConfig {
    return StageTransitionEventsEnvironmentSchema.parse(environment);
}
