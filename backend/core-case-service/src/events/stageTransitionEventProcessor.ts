import {
    ExpenseReportStageTransitionedCloudEventV1Schema,
    type ExpenseReportStageTransitionedCloudEventV1,
} from "./expenseReportStageTransitioned.v1.js";
import {
    defaultStageTransitionProjectionStore,
    type StageTransitionProjectionStore,
} from "./stageTransitionProjectionRepository.js";

/**
 * Validates and projects one stage-transition CloudEvent.
 *
 * Sprint 5 should reuse this transport-independent unit from the Lambda handler.
 */
export async function processStageTransitionEvent(
    input: unknown,
    store: StageTransitionProjectionStore = defaultStageTransitionProjectionStore,
): Promise<ExpenseReportStageTransitionedCloudEventV1> {
    const event = ExpenseReportStageTransitionedCloudEventV1Schema.parse(input);
    await store.project(event);

    return event;
}

/**
 * Parses an SQS message body before validating and projecting its CloudEvent.
 */
export async function processStageTransitionEventBody(
    body: string,
    store: StageTransitionProjectionStore = defaultStageTransitionProjectionStore,
): Promise<ExpenseReportStageTransitionedCloudEventV1> {
    return processStageTransitionEvent(JSON.parse(body) as unknown, store);
}
