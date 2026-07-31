import { randomUUID } from "node:crypto";

import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { z } from "zod";

import {
    loadStageTransitionEventsConfig,
    type StageTransitionEventsConfig,
} from "../config/stageTransitionEventsConfig.js";
import { BadGatewayError } from "../errors/problem-json.js";
import {
    EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
    EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA,
    ExpenseReportStageTransitionedCloudEventV1Schema,
    ExpenseReportStageTransitionedDataV1Schema,
    type ExpenseReportStageTransitionedCloudEventV1,
    type ExpenseReportStageTransitionedDataV1,
} from "./expenseReportStageTransitioned.v1.js";

export type PublishStageTransitionRequest =
    ExpenseReportStageTransitionedDataV1 & {
        eventId?: string;
        occurredAt?: Date;
    };

export type StageTransitionEventPublisher = {
    publish(request: PublishStageTransitionRequest): Promise<void>;
};

type SnsCommandClient = Pick<SNSClient, "send">;

const stageTransitionSnsPublishRequestSchema = z
    .object({
        TopicArn: z.string().trim().min(1),
        Message: z.string().trim().min(1),
        MessageAttributes: z
            .object({
                correlationId: z.object({
                    DataType: z.literal("String"),
                    StringValue: z.uuid(),
                }),
                eventType: z.object({
                    DataType: z.literal("String"),
                    StringValue: z.literal(
                        EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
                    ),
                }),
            })
            .strict(),
    })
    .strict();

let defaultPublisher: StageTransitionEventPublisher | undefined;

/**
 * Returns the configured SNS stage-transition event publisher.
 */
export function getDefaultStageTransitionEventPublisher(): StageTransitionEventPublisher {
    if (defaultPublisher === undefined) {
        const config = loadStageTransitionEventsConfig();
        defaultPublisher = createSnsStageTransitionEventPublisher(
            new SNSClient({
                ...(config.endpoint === undefined
                    ? {}
                    : { endpoint: config.endpoint }),
                region: config.region,
            }),
            config,
        );
    }

    return defaultPublisher;
}

/**
 * Creates an SNS publisher that emits one validated CloudEvent per call.
 */
export function createSnsStageTransitionEventPublisher(
    client: SnsCommandClient,
    config: StageTransitionEventsConfig,
    now: () => Date = () => new Date(),
    createId: () => string = randomUUID,
): StageTransitionEventPublisher {
    return {
        async publish(request) {
            const event = buildStageTransitionCloudEvent(
                request,
                request.occurredAt ?? now(),
                request.eventId ?? createId(),
            );

            try {
                await client.send(
                    new PublishCommand(
                        stageTransitionSnsPublishRequestSchema.parse({
                            TopicArn: config.topicArn,
                            Message: JSON.stringify(event),
                            MessageAttributes: {
                                correlationId: {
                                    DataType: "String",
                                    StringValue: event.correlationid,
                                },
                                eventType: {
                                    DataType: "String",
                                    StringValue: event.type,
                                },
                            },
                        }),
                    ),
                );
            } catch (error: unknown) {
                throw new BadGatewayError(
                    "Stage-transition event publishing failed.",
                    { cause: error },
                );
            }
        },
    };
}

/**
 * Builds and validates the versioned stage-transition CloudEvent.
 */
export function buildStageTransitionCloudEvent(
    request: PublishStageTransitionRequest,
    occurredAt: Date,
    eventId: string,
): ExpenseReportStageTransitionedCloudEventV1 {
    const data = ExpenseReportStageTransitionedDataV1Schema.parse(request);

    return ExpenseReportStageTransitionedCloudEventV1Schema.parse({
        specversion: "1.0",
        type: EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
        source: "urn:expenseflow:core-case-service",
        id: eventId,
        time: occurredAt.toISOString(),
        subject: `expense-reports/${data.caseId}`,
        datacontenttype: "application/json",
        dataschema: EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA,
        correlationid: data.correlationId,
        data,
    });
}

/**
 * Clears the cached publisher between configuration-sensitive tests.
 */
export function resetDefaultStageTransitionEventPublisherForTests(): void {
    defaultPublisher = undefined;
}
