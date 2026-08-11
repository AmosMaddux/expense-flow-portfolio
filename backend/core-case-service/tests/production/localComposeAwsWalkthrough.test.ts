import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DeleteMessageCommand,
    GetQueueAttributesCommand,
    ReceiveMessageCommand,
    SQSClient,
} from "@aws-sdk/client-sqs";
import { GetTopicAttributesCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
    e2eWalkthroughAccounts,
    e2eWalkthroughPassword,
    e2eWalkthroughTenantId,
    readCurrentE2eAccountTotpCode,
    resetE2eTestData,
} from "../../src/dev/e2eTestData.js";
import type { ExpenseReportStageTransitionedCloudEventV1 } from "../../src/events/index.js";
import type { StageTransitionProjectionStore } from "../../src/events/stageTransitionProjectionRepository.js";

loadDotEnvFile();
clearAwsEndpointOverridesForProduction();

const localComposeAwsEnvSchema = z
    .object({
        EXPENSE_FLOW_RUN_PRODUCTION_TESTS: z.literal("1").optional(),
        LOCAL_CORE_CASE_BASE_URL: z
            .url()
            .default("http://127.0.0.1:3301"),
        AWS_REGION: z.string().trim().min(1),
        AWS_ACCESS_KEY_ID: z.string().trim().min(1),
        AWS_SECRET_ACCESS_KEY: z.string().trim().min(1),
        AWS_SESSION_TOKEN: z.string().trim().min(1),
        STAGE_TRANSITION_SNS_TOPIC_ARN: z.string().trim().min(1),
        STAGE_TRANSITION_SQS_QUEUE_URL: z.url(),
        STAGE_TRANSITION_SQS_DLQ_URL: z.url(),
        DYNAMODB_EXPENSE_REPORT_TABLE: z.string().trim().min(1),
        DYNAMODB_EXPENSE_REPORT_TENANT_INDEX: z.string().trim().min(1),
        DATABASE_URL: z.url(),
    })
    .passthrough();

const loginRequestSchema = z
    .object({
        tenantId: z.uuid(),
        email: z.email(),
        password: z.string().min(1),
        totpCode: z.string().regex(/^\d{6}$/),
    })
    .strict();

const loginResponseSchema = z
    .object({
        tenantId: z.uuid(),
        userId: z.uuid(),
        accessToken: z.string().min(1),
        accessTokenExpiresAt: z.iso.datetime(),
        refreshToken: z.string().min(1),
        refreshTokenExpiresAt: z.iso.datetime(),
    })
    .strict();

const createExpenseReportRequestSchema = z
    .object({
        owner: z.uuid(),
        dueDate: z.iso.date(),
        priority: z.enum(["Low", "Normal", "High"]),
    })
    .strict();

const expenseReportResponseSchema = z
    .object({
        id: z.uuid(),
        currentStage: z.enum([
            "Drafted",
            "Submitted",
            "Manager Approval",
            "AP Review",
            "Paid",
            "Reconciled",
        ]),
    })
    .passthrough();

const addDraftContentRequestSchema = z
    .object({
        lineItems: z
            .array(
                z
                    .object({
                        merchant: z.string().min(1),
                        expenseDate: z.iso.date(),
                        category: z.enum(["Travel", "Meals", "Lodging"]),
                        amount: z.number().positive().multipleOf(0.01),
                        currency: z.literal("USD"),
                    })
                    .strict(),
            )
            .min(1),
        receipts: z.array(z.never()),
    })
    .strict();

const addDraftContentResponseSchema = z
    .object({
        expenseReportId: z.uuid(),
        lineItemIds: z.array(z.uuid()).min(1),
        receiptIds: z.array(z.uuid()),
    })
    .strict();

const submitExpenseReportRequestSchema = z
    .object({
        employerEin: z.string().regex(/^\d{9}$/).optional(),
        employerLegalName: z.string().min(1).optional(),
    })
    .strict();

const transitionExpenseReportRequestSchema = z
    .object({
        toStage: z.enum(["Manager Approval", "AP Review"]),
        reason: z.string().min(1),
    })
    .strict();

const reviewLineItemRequestSchema = z
    .object({
        action: z.literal("approve"),
    })
    .strict();

const updateDeductibilityRequestSchema = z
    .object({
        deductible: z.boolean(),
    })
    .strict();

const settleExpenseReportRequestSchema = z
    .object({
        reason: z.string().min(1),
    })
    .strict();

const getTopicAttributesRequestSchema = z
    .object({
        TopicArn: z.string().trim().min(1),
    })
    .strict();

const getQueueAttributesRequestSchema = z
    .object({
        QueueUrl: z.url(),
        AttributeNames: z.tuple([
            z.literal("QueueArn"),
            z.literal("RedrivePolicy"),
        ]),
    })
    .strict();

const describeTableRequestSchema = z
    .object({
        TableName: z.string().trim().min(1),
    })
    .strict();

const putDynamoProjectionRequestSchema = z
    .object({
        TableName: z.string().min(1),
        Item: z
            .object({
                tenantId: z.uuid(),
                id: z.uuid(),
                currentStage: z.literal("Paid"),
                dueDate: z.iso.date(),
                seededBy: z.literal("SCRUM-146-local-compose-aws-walkthrough"),
            })
            .strict(),
    })
    .strict();

const receiveMessageRequestSchema = z
    .object({
        QueueUrl: z.url(),
        MaxNumberOfMessages: z.number().int().min(1).max(10),
        WaitTimeSeconds: z.number().int().min(0).max(20),
        VisibilityTimeout: z.number().int().min(0).max(43_200),
        MessageAttributeNames: z.tuple([z.literal("All")]),
        MessageSystemAttributeNames: z.tuple([
            z.literal("ApproximateReceiveCount"),
        ]),
    })
    .strict();

const deleteMessageRequestSchema = z
    .object({
        QueueUrl: z.url(),
        ReceiptHandle: z.string().min(1),
    })
    .strict();

const stageTransitionCloudEventSchema = z
    .object({
        specversion: z.literal("1.0"),
        type: z.literal("com.expenseflow.expense-report.stage-transitioned.v1"),
        source: z.literal("urn:expenseflow:core-case-service"),
        id: z.uuid(),
        time: z.iso.datetime(),
        subject: z.string().min(1),
        datacontenttype: z.literal("application/json"),
        dataschema: z.string().min(1),
        correlationid: z.uuid(),
        data: z
            .object({
                caseId: z.uuid(),
                tenantId: z.uuid(),
                fromStage: z.enum([
                    "Drafted",
                    "Submitted",
                    "Manager Approval",
                    "AP Review",
                    "Paid",
                    "Reconciled",
                ]),
                toStage: z.enum([
                    "Drafted",
                    "Submitted",
                    "Manager Approval",
                    "AP Review",
                    "Paid",
                    "Reconciled",
                ]),
                correlationId: z.uuid(),
            })
            .strict(),
    })
    .strict();

const shouldRunProductionTests =
    process.env.EXPENSE_FLOW_RUN_PRODUCTION_TESTS === "1";
const describeProduction = shouldRunProductionTests ? describe : describe.skip;

describeProduction("SCRUM-146 local Compose AWS walkthrough", () => {
    test(
        "walks local compose workflow through real SNS, SQS, and DynamoDB resources",
        async () => {
            const env = localComposeAwsEnvSchema.parse(process.env);
            const { createDynamoExpenseReportCaseStore } = await import(
                "../../src/dynamodb/expenseReportCaseStore.js"
            );

            await resetE2eTestData();
            await assertLocalCoreCaseIsReachable(env.LOCAL_CORE_CASE_BASE_URL);

            const snsClient = new SNSClient({ region: env.AWS_REGION });
            const sqsClient = new SQSClient({ region: env.AWS_REGION });
            const dynamoClient = new DynamoDBClient({
                region: env.AWS_REGION,
            });
            const dynamoDocumentClient =
                DynamoDBDocumentClient.from(dynamoClient);

            await assertAwsResourcesExist(
                env,
                snsClient,
                sqsClient,
                dynamoClient,
            );

            const employee = await login(env, "employee");
            const manager = await login(env, "manager");
            const financeAdmin = await login(env, "financeAdmin");
            const transitionCorrelationIds = [
                randomUUID(),
                randomUUID(),
                randomUUID(),
                randomUUID(),
            ];
            const created = await postJson(
                env,
                "/v1/expense-reports",
                employee.accessToken,
                createExpenseReportRequestSchema.parse({
                    owner: employee.userId,
                    dueDate: addDaysIsoDate(7),
                    priority: "Normal",
                }),
                expenseReportResponseSchema,
                {
                    "idempotency-key": `scrum-146-create-${randomUUID()}`,
                },
                201,
            );
            const draftContent = await postJson(
                env,
                `/v1/expense-reports/${created.id}/draft-content`,
                employee.accessToken,
                addDraftContentRequestSchema.parse({
                    lineItems: [
                        {
                            merchant: "Synthetic SCRUM-146 Compose Rail",
                            expenseDate: addDaysIsoDate(-1),
                            category: "Travel",
                            amount: 125.25,
                            currency: "USD",
                        },
                    ],
                    receipts: [],
                }),
                addDraftContentResponseSchema,
                {
                    "idempotency-key": `scrum-146-content-${randomUUID()}`,
                },
                201,
            );
            const lineItemId = draftContent.lineItemIds[0];

            const submitted = await postJson(
                env,
                `/v1/expense-reports/${created.id}/submit`,
                employee.accessToken,
                submitExpenseReportRequestSchema.parse({}),
                expenseReportResponseSchema,
                {
                    "idempotency-key": `scrum-146-submit-${randomUUID()}`,
                    "x-correlation-id": transitionCorrelationIds[0],
                },
                201,
            );
            expect(submitted.currentStage).toBe("Submitted");

            const managerApproval = await postJson(
                env,
                `/v1/expense-reports/${created.id}/transitions`,
                manager.accessToken,
                transitionExpenseReportRequestSchema.parse({
                    toStage: "Manager Approval",
                    reason: "Synthetic SCRUM-146 manager review started.",
                }),
                expenseReportResponseSchema,
                {
                    "x-correlation-id": transitionCorrelationIds[1],
                },
            );
            expect(managerApproval.currentStage).toBe("Manager Approval");

            await postJson(
                env,
                `/v1/expense-reports/${created.id}/line-items/${lineItemId}/review`,
                manager.accessToken,
                reviewLineItemRequestSchema.parse({ action: "approve" }),
                z.unknown(),
            );

            const apReview = await postJson(
                env,
                `/v1/expense-reports/${created.id}/transitions`,
                manager.accessToken,
                transitionExpenseReportRequestSchema.parse({
                    toStage: "AP Review",
                    reason: "Synthetic SCRUM-146 manager approved.",
                }),
                expenseReportResponseSchema,
                {
                    "x-correlation-id": transitionCorrelationIds[2],
                },
            );
            expect(apReview.currentStage).toBe("AP Review");

            await patchJson(
                env,
                `/v1/expense-reports/${created.id}/sources/line_item/${lineItemId}/deductibility`,
                financeAdmin.accessToken,
                updateDeductibilityRequestSchema.parse({ deductible: true }),
                z.unknown(),
            );

            const settled = await postJson(
                env,
                `/v1/expense-reports/${created.id}/settlement`,
                financeAdmin.accessToken,
                settleExpenseReportRequestSchema.parse({
                    reason: "Synthetic SCRUM-146 payment issued.",
                }),
                expenseReportResponseSchema,
                {
                    "idempotency-key": `scrum-146-settle-${randomUUID()}`,
                    "x-correlation-id": transitionCorrelationIds[3],
                },
            );
            expect(settled.currentStage).toBe("Reconciled");

            const projectionStore = createInMemoryProjectionStore();
            const paidEvent = await receiveMatchingStageTransitionEvent(
                sqsClient,
                env.STAGE_TRANSITION_SQS_QUEUE_URL,
                new Set(transitionCorrelationIds),
                created.id,
                "Paid",
                projectionStore,
            );
            expect(paidEvent.data).toMatchObject({
                tenantId: e2eWalkthroughTenantId,
                caseId: created.id,
                fromStage: "AP Review",
                toStage: "Paid",
            });
            expect(projectionStore.projectedEvents).toContainEqual(paidEvent);

            await assertNoMatchingDlqMessage(
                sqsClient,
                env.STAGE_TRANSITION_SQS_DLQ_URL,
                new Set(transitionCorrelationIds),
            );

            await dynamoDocumentClient.send(
                new PutCommand(
                    putDynamoProjectionRequestSchema.parse({
                        TableName: env.DYNAMODB_EXPENSE_REPORT_TABLE,
                        Item: {
                            tenantId: e2eWalkthroughTenantId,
                            id: created.id,
                            currentStage: "Paid",
                            dueDate: addDaysIsoDate(7),
                            seededBy:
                                "SCRUM-146-local-compose-aws-walkthrough",
                        },
                    }),
                ),
            );
            const dynamoStore = createDynamoExpenseReportCaseStore(
                dynamoDocumentClient,
                env.DYNAMODB_EXPENSE_REPORT_TABLE,
            );
            const rollups = await dynamoStore.readCaseQueueStageRollups({
                tenantId: e2eWalkthroughTenantId,
                asOfDate: addDaysIsoDate(0),
            });
            const paidRollup = rollups.find(
                (rollup) => rollup.currentStage === "Paid",
            );

            expect(paidRollup?.reportCount).toBeGreaterThanOrEqual(1);
        },
        180_000,
    );
});

async function assertLocalCoreCaseIsReachable(baseUrl: string): Promise<void> {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);

    expect(response.status).toBe(200);
}

async function assertAwsResourcesExist(
    env: z.infer<typeof localComposeAwsEnvSchema>,
    snsClient: SNSClient,
    sqsClient: SQSClient,
    dynamoClient: DynamoDBClient,
): Promise<void> {
    await assertAwsPreflight(
        "SNS topic",
        snsClient.send(
            new GetTopicAttributesCommand(
                getTopicAttributesRequestSchema.parse({
                    TopicArn: env.STAGE_TRANSITION_SNS_TOPIC_ARN,
                }),
            ),
        ),
    );
    await assertAwsPreflight(
        "SQS queue",
        sqsClient.send(
            new GetQueueAttributesCommand(
                getQueueAttributesRequestSchema.parse({
                    QueueUrl: env.STAGE_TRANSITION_SQS_QUEUE_URL,
                    AttributeNames: ["QueueArn", "RedrivePolicy"],
                }),
            ),
        ),
    );
    await assertAwsPreflight(
        "DynamoDB table",
        dynamoClient.send(
            new DescribeTableCommand(
                describeTableRequestSchema.parse({
                    TableName: env.DYNAMODB_EXPENSE_REPORT_TABLE,
                }),
            ),
        ),
    );
}

async function assertAwsPreflight(
    resourceName: string,
    request: Promise<unknown>,
): Promise<void> {
    try {
        await request;
    } catch (error: unknown) {
        const detail =
            error instanceof Error ? error.message : "Unknown AWS SDK error.";
        throw new Error(`${resourceName} preflight failed: ${detail}`);
    }
}

async function login(
    env: z.infer<typeof localComposeAwsEnvSchema>,
    accountName: keyof typeof e2eWalkthroughAccounts,
): Promise<z.infer<typeof loginResponseSchema>> {
    const account = e2eWalkthroughAccounts[accountName];
    const totpCode = await readCurrentE2eAccountTotpCode(accountName);

    return postJson(
        env,
        "/v1/auth/login",
        undefined,
        loginRequestSchema.parse({
            tenantId: e2eWalkthroughTenantId,
            email: account.email,
            password: e2eWalkthroughPassword,
            totpCode,
        }),
        loginResponseSchema,
    );
}

async function postJson<TRequest, TResponse>(
    env: z.infer<typeof localComposeAwsEnvSchema>,
    path: string,
    accessToken: string | undefined,
    requestBody: TRequest,
    responseSchema: z.ZodType<TResponse>,
    headers: Record<string, string> = {},
    expectedStatus = 200,
): Promise<TResponse> {
    return sendJson(
        env,
        "POST",
        path,
        accessToken,
        requestBody,
        responseSchema,
        headers,
        expectedStatus,
    );
}

async function patchJson<TRequest, TResponse>(
    env: z.infer<typeof localComposeAwsEnvSchema>,
    path: string,
    accessToken: string,
    requestBody: TRequest,
    responseSchema: z.ZodType<TResponse>,
): Promise<TResponse> {
    return sendJson(
        env,
        "PATCH",
        path,
        accessToken,
        requestBody,
        responseSchema,
    );
}

async function sendJson<TRequest, TResponse>(
    env: z.infer<typeof localComposeAwsEnvSchema>,
    method: "PATCH" | "POST",
    path: string,
    accessToken: string | undefined,
    requestBody: TRequest,
    responseSchema: z.ZodType<TResponse>,
    headers: Record<string, string> = {},
    expectedStatus = 200,
): Promise<TResponse> {
    const response = await fetch(
        `${env.LOCAL_CORE_CASE_BASE_URL.replace(/\/$/, "")}${path}`,
        {
            method,
            headers: {
                "content-type": "application/json",
                ...(accessToken === undefined
                    ? {}
                    : { authorization: `Bearer ${accessToken}` }),
                ...headers,
            },
            body: JSON.stringify(requestBody),
        },
    );
    const body = (await response.json()) as unknown;

    if (response.status !== expectedStatus) {
        throw new Error(
            `Expected ${method} ${path} to return ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`,
        );
    }

    return responseSchema.parse(body);
}

async function receiveMatchingStageTransitionEvent(
    client: SQSClient,
    queueUrl: string,
    correlationIds: Set<string>,
    caseId: string,
    toStage: "Paid",
    store: StageTransitionProjectionStore,
): Promise<ExpenseReportStageTransitionedCloudEventV1> {
    const { processStageTransitionEvent } = await import(
        "../../src/events/index.js"
    );
    const deadline = Date.now() + 120_000;

    while (Date.now() < deadline) {
        const response = await client.send(
            new ReceiveMessageCommand(
                receiveMessageRequestSchema.parse({
                    QueueUrl: queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 10,
                    VisibilityTimeout: 5,
                    MessageAttributeNames: ["All"],
                    MessageSystemAttributeNames: ["ApproximateReceiveCount"],
                }),
            ),
        );

        for (const message of response.Messages ?? []) {
            if (
                message.Body === undefined ||
                message.ReceiptHandle === undefined
            ) {
                continue;
            }

            const candidate = parseStageTransitionEvent(message.Body);
            if (
                candidate !== undefined &&
                candidate.data.caseId === caseId &&
                correlationIds.has(candidate.correlationid) &&
                candidate.data.toStage === toStage
            ) {
                await processStageTransitionEvent(candidate, store);
                await client.send(
                    new DeleteMessageCommand(
                        deleteMessageRequestSchema.parse({
                            QueueUrl: queueUrl,
                            ReceiptHandle: message.ReceiptHandle,
                        }),
                    ),
                );
                return candidate;
            }
        }
    }

    throw new Error("Timed out waiting for SCRUM-146 Paid stage event in SQS.");
}

async function assertNoMatchingDlqMessage(
    client: SQSClient,
    queueUrl: string,
    correlationIds: Set<string>,
): Promise<void> {
    const response = await client.send(
        new ReceiveMessageCommand(
            receiveMessageRequestSchema.parse({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: 10,
                WaitTimeSeconds: 2,
                VisibilityTimeout: 5,
                MessageAttributeNames: ["All"],
                MessageSystemAttributeNames: ["ApproximateReceiveCount"],
            }),
        ),
    );
    const matchingMessage = (response.Messages ?? []).find((message) => {
        if (message.Body === undefined) {
            return false;
        }

        const event = parseStageTransitionEvent(message.Body);
        return event !== undefined && correlationIds.has(event.correlationid);
    });

    expect(matchingMessage).toBeUndefined();
}

function createInMemoryProjectionStore(): StageTransitionProjectionStore & {
    projectedEvents: ExpenseReportStageTransitionedCloudEventV1[];
} {
    const projectedEvents: ExpenseReportStageTransitionedCloudEventV1[] = [];

    return {
        projectedEvents,
        async project(event) {
            projectedEvents.push(event);
        },
    };
}

function parseStageTransitionEvent(
    body: string,
): ExpenseReportStageTransitionedCloudEventV1 | undefined {
    let parsed: unknown;

    try {
        parsed = JSON.parse(body) as unknown;
    } catch {
        return undefined;
    }

    const direct = stageTransitionCloudEventSchema.safeParse(parsed);
    if (direct.success) {
        return direct.data as ExpenseReportStageTransitionedCloudEventV1;
    }

    const snsEnvelope = z
        .object({
            Message: z.string().min(1),
        })
        .passthrough()
        .safeParse(parsed);
    if (!snsEnvelope.success) {
        return undefined;
    }

    try {
        return stageTransitionCloudEventSchema.parse(
            JSON.parse(snsEnvelope.data.Message) as unknown,
        ) as ExpenseReportStageTransitionedCloudEventV1;
    } catch {
        return undefined;
    }
}

function loadDotEnvFile(): void {
    const envFile = process.env.ENV_FILE ?? resolve(process.cwd(), ".env");

    if (!existsSync(envFile)) {
        return;
    }

    const parsedValues = new Map<string, string>();

    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/u)) {
        const parsed = parseDotEnvLine(line);

        if (parsed === undefined) {
            continue;
        }

        parsedValues.set(parsed.key, parsed.value);
    }

    for (const [key, value] of parsedValues.entries()) {
        if (shouldDotEnvOverrideProcessEnv(key)) {
            process.env[key] = value;
            continue;
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function shouldDotEnvOverrideProcessEnv(key: string): boolean {
    return (
        key === "AWS_ACCESS_KEY_ID" ||
        key === "AWS_SECRET_ACCESS_KEY" ||
        key === "AWS_SESSION_TOKEN" ||
        key === "AWS_CREDENTIAL_EXPIRATION" ||
        key === "AUTH_JWT_KEY_ID" ||
        key === "AUTH_JWT_PRIVATE_KEY_BASE64" ||
        key === "MFA_TOTP_SECRET_ENCRYPTION_KEY" ||
        key === "MFA_TOTP_SECRET_KEY_VERSION"
    );
}

function clearAwsEndpointOverridesForProduction(): void {
    if (process.env.ALLOW_AWS_ENDPOINT_OVERRIDES === "true") {
        return;
    }

    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
    delete process.env.AWS_ENDPOINT_URL_SNS;
    delete process.env.AWS_ENDPOINT_URL_SQS;
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.STAGE_TRANSITION_SNS_ENDPOINT;
    delete process.env.STAGE_TRANSITION_SQS_ENDPOINT;
}

function parseDotEnvLine(
    line: string,
): { key: string; value: string } | undefined {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
        return undefined;
    }

    const match =
        /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed) ??
        /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (match === null) {
        return undefined;
    }

    return {
        key: match[1],
        value: unquoteDotEnvValue(match[2]),
    };
}

function unquoteDotEnvValue(value: string): string {
    const trimmed = value.trim();

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function addDaysIsoDate(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
