import {
    type DynamoDBDocumentClient,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { approvedWorkflowStages } from "../db/schema/index.js";
import {
    CaseQueueStageRollupListSchema,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
} from "../expenseReports/dto/expenseReportDto.js";
import { dynamoDbDocumentClient } from "./client.js";

type ExpenseReportStage = (typeof approvedWorkflowStages)[number];

export type ExpenseReportCaseStore = {
    readCaseQueueStageRollups(
        params: ReadCaseQueueStageRollupsParams,
    ): Promise<CaseQueueStageRollup[]>;
};

const dynamoExpenseReportItemSchema = z.object({
    currentStage: z.enum(approvedWorkflowStages),
    dueDate: z.iso.date(),
});

/**
 * Builds the DynamoDB-backed Expense Report case store.
 */
export function createDynamoExpenseReportCaseStore(
    client: DynamoDBDocumentClient = dynamoDbDocumentClient,
    tableName = readExpenseReportTableName(),
): ExpenseReportCaseStore {
    return {
        async readCaseQueueStageRollups(params) {
            const items = await queryExpenseReportsByTenant(
                client,
                tableName,
                params.tenantId,
            );

            return rollupExpenseReports(items, params.asOfDate);
        },
    };
}

/**
 * Reads the DynamoDB table name that stores Expense Report cases.
 */
export function readExpenseReportTableName(): string {
    const tableName = process.env.DYNAMODB_EXPENSE_REPORT_TABLE;

    if (tableName === undefined || tableName.trim() === "") {
        throw new Error("DYNAMODB_EXPENSE_REPORT_TABLE is required.");
    }

    return tableName;
}

async function queryExpenseReportsByTenant(
    client: DynamoDBDocumentClient,
    tableName: string,
    tenantId: string,
): Promise<Array<z.infer<typeof dynamoExpenseReportItemSchema>>> {
    const items: Array<z.infer<typeof dynamoExpenseReportItemSchema>> = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
        const result = await client.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: process.env.DYNAMODB_EXPENSE_REPORT_TENANT_INDEX,
                KeyConditionExpression: "#tenantId = :tenantId",
                ProjectionExpression: "#currentStage, #dueDate",
                ExpressionAttributeNames: {
                    "#tenantId": "tenantId",
                    "#currentStage": "currentStage",
                    "#dueDate": "dueDate",
                },
                ExpressionAttributeValues: {
                    ":tenantId": tenantId,
                },
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );

        items.push(
            ...(result.Items ?? []).map((item) =>
                dynamoExpenseReportItemSchema.parse(item),
            ),
        );
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    return items;
}

function rollupExpenseReports(
    items: Array<z.infer<typeof dynamoExpenseReportItemSchema>>,
    asOfDate: string,
): CaseQueueStageRollup[] {
    const rollups = approvedWorkflowStages.map((currentStage) => ({
        currentStage,
        reportCount: 0,
        overdueCount: 0,
    }));
    const rollupByStage = new Map<ExpenseReportStage, CaseQueueStageRollup>(
        rollups.map((rollup) => [rollup.currentStage, rollup]),
    );

    for (const item of items) {
        const rollup = rollupByStage.get(item.currentStage);

        if (rollup === undefined) {
            continue;
        }

        rollup.reportCount += 1;

        if (item.dueDate < asOfDate) {
            rollup.overdueCount += 1;
        }
    }

    return CaseQueueStageRollupListSchema.parse(rollups);
}
