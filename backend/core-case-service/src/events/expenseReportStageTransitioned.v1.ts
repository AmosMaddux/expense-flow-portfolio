import { z } from "zod";

import { approvedWorkflowStages } from "../db/schema/index.js";
import { isExpenseReportWorkflowEdge } from "../expenseReports/domain/expenseReportWorkflow.js";

export const EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE =
    "com.expenseflow.expense-report.stage-transitioned.v1" as const;

export const EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA =
    "urn:expenseflow:schema:events:expense-report-stage-transitioned:v1" as const;

export const ExpenseReportStageTransitionedDataV1Schema = z
    .object({
        caseId: z.uuid(),
        tenantId: z.uuid(),
        fromStage: z.enum(approvedWorkflowStages),
        toStage: z.enum(approvedWorkflowStages),
        correlationId: z.uuid(),
    })
    .strict()
    .refine(
        (data) => isExpenseReportWorkflowEdge(data.fromStage, data.toStage),
        {
            message: "Stage transition must use an allowed workflow edge.",
            path: ["toStage"],
        },
    );

export const ExpenseReportStageTransitionedCloudEventV1Schema = z
    .object({
        specversion: z.literal("1.0"),
        type: z.literal(EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE),
        source: z.literal("urn:expenseflow:core-case-service"),
        id: z.uuid(),
        time: z.iso.datetime({ offset: true }),
        subject: z.string().regex(/^expense-reports\/[0-9a-f-]{36}$/i),
        datacontenttype: z.literal("application/json"),
        dataschema: z.literal(EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA),
        correlationid: z.uuid(),
        data: ExpenseReportStageTransitionedDataV1Schema,
    })
    .strict()
    .superRefine((event, context) => {
        if (event.subject !== `expense-reports/${event.data.caseId}`) {
            context.addIssue({
                code: "custom",
                message: "CloudEvent subject must identify data.caseId.",
                path: ["subject"],
            });
        }

        if (event.correlationid !== event.data.correlationId) {
            context.addIssue({
                code: "custom",
                message:
                    "CloudEvent correlationid must match data.correlationId.",
                path: ["correlationid"],
            });
        }
    });

export type ExpenseReportStageTransitionedDataV1 = z.infer<
    typeof ExpenseReportStageTransitionedDataV1Schema
>;

export type ExpenseReportStageTransitionedCloudEventV1 = z.infer<
    typeof ExpenseReportStageTransitionedCloudEventV1Schema
>;
