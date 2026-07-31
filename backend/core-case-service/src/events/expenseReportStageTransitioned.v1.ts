import { z } from "zod";

export const ExpenseReportStageTransitionedEventSchema = z.object({
    specversion: z.literal("1.0"),
    id: z.uuid(),
    source: z.literal("expense-flow.core-case-service"),
    type: z.literal("expense-report.stage-transitioned.v1"),
    subject: z.string().min(1),
    time: z.iso.datetime(),
    datacontenttype: z.literal("application/json"),
    data: z.object({
        caseId: z.uuid(),
        tenantId: z.uuid(),
        stageTransitionId: z.uuid(),
        fromStage: z.string().min(1),
        toStage: z.string().min(1),
        correlationId: z.uuid(),
    }),
});

export type ExpenseReportStageTransitionedEvent = z.infer<
    typeof ExpenseReportStageTransitionedEventSchema
>;

export type BuildExpenseReportStageTransitionedEventRequest = {
    eventId: string;
    expenseReportId: string;
    tenantId: string;
    stageTransitionId: string;
    fromStage: string;
    toStage: string;
    correlationId: string;
    occurredAt: Date;
};

/**
 * Builds the CloudEvents payload for a committed Expense Report stage transition.
 */
export function buildExpenseReportStageTransitionedEvent(
    request: BuildExpenseReportStageTransitionedEventRequest,
): ExpenseReportStageTransitionedEvent {
    return ExpenseReportStageTransitionedEventSchema.parse({
        specversion: "1.0",
        id: request.eventId,
        source: "expense-flow.core-case-service",
        type: "expense-report.stage-transitioned.v1",
        subject: `expense-report/${request.expenseReportId}`,
        time: request.occurredAt.toISOString(),
        datacontenttype: "application/json",
        data: {
            caseId: request.expenseReportId,
            tenantId: request.tenantId,
            stageTransitionId: request.stageTransitionId,
            fromStage: request.fromStage,
            toStage: request.toStage,
            correlationId: request.correlationId,
        },
    });
}
