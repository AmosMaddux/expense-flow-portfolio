import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

const environmentSchema = z.object({
    AWS_REGION: z.string().min(1).default("us-east-1"),
    DYNAMODB_EXPENSE_REPORT_TABLE: z.string().min(1),
    STAGE_TRANSITION_SNS_TOPIC_ARN: z.string().min(1),
    STAGE_TRANSITION_SQS_QUEUE_URL: z.string().min(1),
    AWS_ENDPOINT_URL_DYNAMODB: z.string().url().optional(),
    STAGE_TRANSITION_SNS_ENDPOINT: z.string().url().optional(),
    STAGE_TRANSITION_SQS_ENDPOINT: z.string().url().optional(),
});

const getExpenseReportQuerySchema = z.object({
    id: z.string().trim().min(1).max(128),
    tenantId: z.uuid(),
});

const postExpenseReportBodySchema = z.object({
    amountCents: z.number().int().nonnegative().optional(),
    currentStage: z.enum([
        "Drafted",
        "Submitted",
        "Manager Approval",
        "AP Review",
        "Paid",
        "Reconciled",
    ]),
    dueDate: z.iso.date(),
    id: z.string().trim().min(1).max(128),
    memo: z.string().trim().max(500).optional(),
    tenantId: z.uuid(),
});

const expenseReportItemSchema = postExpenseReportBodySchema.extend({
    createdAt: z.iso.datetime(),
});

const successResponseSchema = z.object({
    expenseReport: expenseReportItemSchema,
    messageId: z.string().optional(),
    notificationId: z.string().optional(),
});

const errorResponseSchema = z.object({
    message: z.string(),
});

let cachedClients;

export async function handler(event) {
    try {
        const method =
            event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET";

        if (method === "GET") {
            return await handleGet(event);
        }

        if (method === "POST") {
            return await handlePost(event);
        }

        return jsonResponse(405, { message: `Unsupported method: ${method}` });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return jsonResponse(400, { message: "Request validation failed." });
        }

        if (error?.name === "ConditionalCheckFailedException") {
            return jsonResponse(409, {
                message: "Expense Report already exists.",
            });
        }

        console.error("Lambda request failed.", { error });
        return jsonResponse(500, { message: "Internal server error." });
    }
}

async function handleGet(event) {
    const env = environmentSchema.parse(process.env);
    const query = getExpenseReportQuerySchema.parse(
        event?.queryStringParameters ?? {},
    );
    const { dynamoDbClient } = clients(env);
    const result = await dynamoDbClient.send(
        new GetCommand({
            Key: { id: query.id },
            TableName: env.DYNAMODB_EXPENSE_REPORT_TABLE,
        }),
    );

    if (result.Item === undefined || result.Item.tenantId !== query.tenantId) {
        return jsonResponse(404, { message: "Expense Report not found." });
    }

    return jsonResponse(200, {
        expenseReport: expenseReportItemSchema.parse(result.Item),
    });
}

async function handlePost(event) {
    const env = environmentSchema.parse(process.env);
    const request = postExpenseReportBodySchema.parse(
        JSON.parse(event?.body ?? "{}"),
    );
    const expenseReport = expenseReportItemSchema.parse({
        ...request,
        createdAt: new Date().toISOString(),
    });
    const eventPayload = JSON.stringify({
        detailType: "Expense Report Stored",
        expenseReportId: expenseReport.id,
        tenantId: expenseReport.tenantId,
    });
    const { dynamoDbClient, snsClient, sqsClient } = clients(env);

    await dynamoDbClient.send(
        new PutCommand({
            ConditionExpression: "attribute_not_exists(id)",
            Item: expenseReport,
            TableName: env.DYNAMODB_EXPENSE_REPORT_TABLE,
        }),
    );

    const [snsResult, sqsResult] = await Promise.all([
        snsClient.send(
            new PublishCommand({
                Message: eventPayload,
                TopicArn: env.STAGE_TRANSITION_SNS_TOPIC_ARN,
            }),
        ),
        sqsClient.send(
            new SendMessageCommand({
                MessageBody: eventPayload,
                QueueUrl: env.STAGE_TRANSITION_SQS_QUEUE_URL,
            }),
        ),
    ]);

    return jsonResponse(201, {
        expenseReport,
        messageId: sqsResult.MessageId,
        notificationId: snsResult.MessageId,
    });
}

function clients(env) {
    if (cachedClients !== undefined) {
        return cachedClients;
    }

    cachedClients = {
        dynamoDbClient: DynamoDBDocumentClient.from(
            new DynamoDBClient({
                endpoint: env.AWS_ENDPOINT_URL_DYNAMODB,
                region: env.AWS_REGION,
            }),
        ),
        snsClient: new SNSClient({
            endpoint: env.STAGE_TRANSITION_SNS_ENDPOINT,
            region: env.AWS_REGION,
        }),
        sqsClient: new SQSClient({
            endpoint: env.STAGE_TRANSITION_SQS_ENDPOINT,
            region: env.AWS_REGION,
        }),
    };

    return cachedClients;
}

function jsonResponse(statusCode, body) {
    return {
        body: JSON.stringify(
            statusCode >= 400
                ? errorResponseSchema.parse(body)
                : successResponseSchema.parse(body),
        ),
        headers: { "content-type": "application/json" },
        statusCode,
    };
}
