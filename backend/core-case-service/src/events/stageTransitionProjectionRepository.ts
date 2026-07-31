import { db } from "../db/client.js";
import { stageTransitionProjection } from "../db/schema/expenseReport.js";
import type { ExpenseReportStageTransitionedCloudEventV1 } from "./expenseReportStageTransitioned.v1.js";

export type StageTransitionProjectionStore = {
    project(event: ExpenseReportStageTransitionedCloudEventV1): Promise<void>;
};

/**
 * Idempotently records a validated stage-transition event in the projection.
 */
export async function projectStageTransition(
    event: ExpenseReportStageTransitionedCloudEventV1,
): Promise<void> {
    await db
        .insert(stageTransitionProjection)
        .values({
            eventId: event.id,
            tenantId: event.data.tenantId,
            expenseReportId: event.data.caseId,
            correlationId: event.data.correlationId,
            previousStage: event.data.fromStage,
            currentStage: event.data.toStage,
            transitionedAt: new Date(event.time),
        })
        .onConflictDoNothing({
            target: stageTransitionProjection.eventId,
        });
}

export const defaultStageTransitionProjectionStore: StageTransitionProjectionStore =
    {
        project: projectStageTransition,
    };
