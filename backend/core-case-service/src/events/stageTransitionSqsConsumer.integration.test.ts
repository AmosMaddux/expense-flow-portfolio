import { randomUUID } from "node:crypto";

import {
    CreateQueueCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    ReceiveMessageCommand,
    SendMessageCommand,
    SQSClient,
} from "@aws-sdk/client-sqs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import type { StageTransitionConsumerConfig } from "../config/stageTransitionConsumerConfig.js";
import {
    expenseReport,
    stageTransitionProjection,
} from "../db/schema/expenseReport.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import type { ExpenseReportStageTransitionedCloudEventV1 } from "./expenseReportStageTransitioned.v1.js";
import type { StageTransitionProjectionStore } from "./stageTransitionProjectionRepository.js";
import { pollStageTransitionQueueOnce } from "./stageTransitionSqsConsumer.js";

const localStackEndpoint = process.env.STAGE_TRANSITION_SQS_ENDPOINT;
const shouldRunLocalStackRedriveTests =
    process.env.EXPENSE_FLOW_RUN_LOCALSTACK_TESTS === "1" ||
    localStackEndpoint !== undefined;

void describe.skipIf(!shouldRunLocalStackRedriveTests)(
    "stage-transition SQS redrive integration",
    () => {
        void test("redrives a failed consumer message to the configured DLQ without changing durable case state", async () => {
            const client = new SQSClient({
                credentials: {
                    accessKeyId: "expenseflow-local",
                    secretAccessKey: "expenseflow-local-dev-only",
                },
                endpoint: localStackEndpoint ?? "http://127.0.0.1:4566",
                region: process.env.AWS_REGION ?? "us-east-1",
            });
            const pool = new Pool({
                connectionString: getCoreCaseTestDatabaseUrl(),
            });
            const db = drizzle(pool);
            const queueSuffix = randomUUID().slice(0, 8);
            const dlqUrl = await createQueue(
                client,
                `expenseflow-stage-dlq-test-${queueSuffix}`,
            );
            const dlqArn = await readQueueArn(client, dlqUrl);
            const queueUrl = await createQueue(
                client,
                `expenseflow-stage-test-${queueSuffix}`,
                {
                    RedrivePolicy: JSON.stringify({
                        deadLetterTargetArn: dlqArn,
                        maxReceiveCount: "1",
                    }),
                    VisibilityTimeout: "0",
                },
            );
            const config: StageTransitionConsumerConfig = {
                queueUrl,
                region: process.env.AWS_REGION ?? "us-east-1",
            };
            const tenantId = randomUUID();
            const expenseReportId = randomUUID();
            const syntheticEvent = buildSyntheticEvent(
                tenantId,
                expenseReportId,
            );
            const store: StageTransitionProjectionStore & {
                project: ReturnType<typeof vi.fn>;
            } = {
                project: vi.fn(),
            };
            store.project.mockRejectedValue(
                new Error("synthetic projection failure"),
            );

            try {
                await db.insert(expenseReport).values({
                    id: expenseReportId,
                    tenantId,
                    owner: randomUUID(),
                    dueDate: "2026-08-15",
                    currentStage: "Manager Approval",
                });
                await client.send(
                    new SendMessageCommand({
                        MessageBody: JSON.stringify(syntheticEvent),
                        QueueUrl: queueUrl,
                    }),
                );

                for (let attempt = 0; attempt < 5; attempt += 1) {
                    await pollStageTransitionQueueOnce(client, config, {
                        logger: {
                            messageFailed: vi.fn(),
                            pollFailed: vi.fn(),
                        },
                        store,
                    });

                    const dlqMessage = await receiveDlqMessage(client, dlqUrl);
                    if (dlqMessage !== undefined) {
                        expect(dlqMessage).toBe(JSON.stringify(syntheticEvent));
                        const [persistedReport, failedProjectionRows] =
                            await Promise.all([
                                db
                                    .select()
                                    .from(expenseReport)
                                    .where(
                                        eq(expenseReport.id, expenseReportId),
                                    )
                                    .limit(1),
                                db
                                    .select()
                                    .from(stageTransitionProjection)
                                    .where(
                                        eq(
                                            stageTransitionProjection.eventId,
                                            syntheticEvent.id,
                                        ),
                                    ),
                            ]);

                        expect(persistedReport[0]).toMatchObject({
                            id: expenseReportId,
                            tenantId,
                            currentStage: "Manager Approval",
                        });
                        expect(failedProjectionRows).toHaveLength(0);
                        expect(store.project).toHaveBeenCalled();
                        return;
                    }
                }

                throw new Error(
                    "Expected failed stage-transition message to reach the DLQ.",
                );
            } finally {
                await Promise.allSettled([
                    client.send(new DeleteQueueCommand({ QueueUrl: queueUrl })),
                    client.send(new DeleteQueueCommand({ QueueUrl: dlqUrl })),
                    pool.end(),
                ]);
                client.destroy();
            }
        });
    },
);

function buildSyntheticEvent(
    tenantId: string,
    expenseReportId: string,
): ExpenseReportStageTransitionedCloudEventV1 {
    const correlationId = randomUUID();

    return {
        specversion: "1.0",
        type: "com.expenseflow.expense-report.stage-transitioned.v1",
        source: "urn:expenseflow:core-case-service",
        id: randomUUID(),
        time: "2026-07-30T14:30:00.000Z",
        subject: `expense-reports/${expenseReportId}`,
        datacontenttype: "application/json",
        dataschema:
            "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1",
        correlationid: correlationId,
        data: {
            caseId: expenseReportId,
            tenantId,
            fromStage: "Manager Approval",
            toStage: "AP Review",
            correlationId,
        },
    };
}

async function createQueue(
    client: SQSClient,
    queueName: string,
    attributes: Record<string, string> = {},
): Promise<string> {
    const response = await client.send(
        new CreateQueueCommand({
            Attributes: attributes,
            QueueName: queueName,
        }),
    );

    if (response.QueueUrl === undefined) {
        throw new Error("LocalStack did not return a queue URL.");
    }

    return response.QueueUrl;
}

async function readQueueArn(
    client: SQSClient,
    queueUrl: string,
): Promise<string> {
    const response = await client.send(
        new GetQueueAttributesCommand({
            AttributeNames: ["QueueArn"],
            QueueUrl: queueUrl,
        }),
    );
    const queueArn = response.Attributes?.QueueArn;
    if (queueArn === undefined) {
        throw new Error("LocalStack did not return a queue ARN.");
    }

    return queueArn;
}

async function receiveDlqMessage(
    client: SQSClient,
    queueUrl: string,
): Promise<string | undefined> {
    const response = await client.send(
        new ReceiveMessageCommand({
            MaxNumberOfMessages: 1,
            QueueUrl: queueUrl,
            WaitTimeSeconds: 1,
        }),
    );

    return response.Messages?.[0]?.Body;
}
