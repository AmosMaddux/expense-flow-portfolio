import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
    approvedWorkflowStages,
    priorityLevels,
} from "../../db/schema/index.js";

extendZodWithOpenApi(z);

const financeDashboardTrendMaxDays = 31;

export const CreateExpenseReportInboundRequestSchema = z
    .object({
        owner: z.uuid(),
        dueDate: z.iso.date(),
        priority: z.enum(priorityLevels).default("Normal"),
    })
    .strict();

export const GetExpenseReportInboundRequestSchema = z.object({
    id: z.uuid(),
});

export const SubmitExpenseReportInboundRequestSchema = z.object({}).strict();

export const TransitionExpenseReportWorkflowInboundRequestSchema = z
    .object({
        toStage: z.enum(approvedWorkflowStages),
        reason: z.string().trim().min(1),
    })
    .strict();

export const ClearExpenseReportFlagsInboundRequestSchema = z
    .object({
        sourceIds: z.array(z.uuid()).min(1),
        reason: z.string().trim().min(1),
    })
    .strict();

export const ReadCaseQueueStageRollupsInboundRequestSchema = z.object({
    tenantId: z.uuid(),
    asOfDate: z.iso.date(),
});

export const ReadCaseQueueStageRollupsQuerySchema = z.object({
    asOfDate: z.iso.date(),
});

const financeDashboardTrendDateRangeSchema = z
    .object({
        fromDate: z.iso.date(),
        toDate: z.iso.date(),
    })
    .refine((request) => request.fromDate <= request.toDate, {
        message: "fromDate must be on or before toDate.",
        path: ["fromDate"],
    })
    .refine((request) => isWithinFinanceDashboardTrendRange(request), {
        message: `Finance Dashboard trends support at most ${financeDashboardTrendMaxDays} days.`,
        path: ["toDate"],
    });

export const ReadFinanceDashboardTrendInboundRequestSchema =
    financeDashboardTrendDateRangeSchema.extend({
        tenantId: z.uuid(),
    });

export const ReadFinanceDashboardTrendQuerySchema =
    financeDashboardTrendDateRangeSchema;

export const TransitionExpenseReportStageInboundRequestSchema = z.object({
    tenantId: z.uuid(),
    id: z.uuid(),
    actor: z.uuid(),
    fromStage: z.enum(approvedWorkflowStages),
    toStage: z.enum(approvedWorkflowStages),
    reason: z.string().trim().min(1),
});

export const IdempotentSubmissionHeaderSchema = z.object({
    idempotencyKey: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9._:-]+$/),
});

function isWithinFinanceDashboardTrendRange(request: {
    fromDate: string;
    toDate: string;
}): boolean {
    const fromTime = Date.parse(`${request.fromDate}T00:00:00.000Z`);
    const toTime = Date.parse(`${request.toDate}T00:00:00.000Z`);
    const dayCount = (toTime - fromTime) / 86_400_000 + 1;

    return dayCount <= financeDashboardTrendMaxDays;
}

// Outbound response gatekeeper: only the public Expense Report case shape leaves the API.
export const ExpenseReportOutboundResponseSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    owner: z.uuid(),
    dueDate: z.iso.date(),
    priority: z.enum(priorityLevels),
    currentStage: z.enum(approvedWorkflowStages),
    onHold: z.boolean(),
    holdReason: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const CaseQueueStageRollupSchema = z.object({
    currentStage: z.enum(approvedWorkflowStages),
    reportCount: z.number().int().nonnegative(),
    overdueCount: z.number().int().nonnegative(),
});

export const CaseQueueStageRollupListSchema = z.array(
    CaseQueueStageRollupSchema,
);

export const FinanceDashboardTrendSpendBucketSchema = z.object({
    currency: z.string().min(3).max(8),
    spendAmount: z.string().regex(/^\d{1,12}\.\d{2}$/),
});

export const FinanceDashboardTrendPointSchema = z.object({
    periodStart: z.iso.date(),
    reportCount: z.number().int().nonnegative(),
    spendByCurrency: z.array(FinanceDashboardTrendSpendBucketSchema),
});

export const FinanceDashboardTrendPointListSchema = z.array(
    FinanceDashboardTrendPointSchema,
);

// Audit responses intentionally expose structured facts, never raw request bodies or payment data.
export const AuditEntryOutboundResponseSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    expenseReportId: z.uuid(),
    actorId: z.uuid(),
    action: z.string().min(1),
    stageBeforeAction: z.enum(approvedWorkflowStages),
    stageAfterProposedAction: z.enum(approvedWorkflowStages),
    denialReason: z.string().nullable(),
    outcomeReason: z.string().nullable(),
    createdAt: z.date(),
});

export const AuditEntryListOutboundResponseSchema = z.array(
    AuditEntryOutboundResponseSchema,
);

export const createExpenseReportRequestSchema =
    CreateExpenseReportInboundRequestSchema;

export const getExpenseReportRequestSchema =
    GetExpenseReportInboundRequestSchema;

export const submitExpenseReportRequestSchema =
    SubmitExpenseReportInboundRequestSchema;

export const transitionExpenseReportWorkflowRequestSchema =
    TransitionExpenseReportWorkflowInboundRequestSchema;

export const clearExpenseReportFlagsRequestSchema =
    ClearExpenseReportFlagsInboundRequestSchema;

export const expenseReportResponseSchema = ExpenseReportOutboundResponseSchema;

export const readCaseQueueStageRollupsRequestSchema =
    ReadCaseQueueStageRollupsInboundRequestSchema;

export const readCaseQueueStageRollupsQuerySchema =
    ReadCaseQueueStageRollupsQuerySchema;

export const readFinanceDashboardTrendRequestSchema =
    ReadFinanceDashboardTrendInboundRequestSchema;

export const readFinanceDashboardTrendQuerySchema =
    ReadFinanceDashboardTrendQuerySchema;

export const transitionExpenseReportStageRequestSchema =
    TransitionExpenseReportStageInboundRequestSchema;

export const caseQueueStageRollupSchema = CaseQueueStageRollupSchema;

export const caseQueueStageRollupListSchema = CaseQueueStageRollupListSchema;

export const financeDashboardTrendSpendBucketSchema =
    FinanceDashboardTrendSpendBucketSchema;

export const financeDashboardTrendPointSchema =
    FinanceDashboardTrendPointSchema;

export const financeDashboardTrendPointListSchema =
    FinanceDashboardTrendPointListSchema;

export const auditEntryResponseSchema = AuditEntryOutboundResponseSchema;

export const auditEntryListResponseSchema =
    AuditEntryListOutboundResponseSchema;

export type CreateExpenseReportRequest = z.infer<
    typeof CreateExpenseReportInboundRequestSchema
>;

export type GetExpenseReportRequest = z.infer<
    typeof GetExpenseReportInboundRequestSchema
>;

export type SubmitExpenseReportRequest = z.infer<
    typeof SubmitExpenseReportInboundRequestSchema
>;

export type TransitionExpenseReportWorkflowRequest = z.infer<
    typeof TransitionExpenseReportWorkflowInboundRequestSchema
>;

export type ClearExpenseReportFlagsRequest = z.infer<
    typeof ClearExpenseReportFlagsInboundRequestSchema
>;

export type ExpenseReportResponse = z.infer<
    typeof ExpenseReportOutboundResponseSchema
>;

export type ReadCaseQueueStageRollupsParams = z.infer<
    typeof ReadCaseQueueStageRollupsInboundRequestSchema
>;

export type ReadCaseQueueStageRollupsQuery = z.infer<
    typeof ReadCaseQueueStageRollupsQuerySchema
>;

export type ReadFinanceDashboardTrendParams = z.infer<
    typeof ReadFinanceDashboardTrendInboundRequestSchema
>;

export type ReadFinanceDashboardTrendQuery = z.infer<
    typeof ReadFinanceDashboardTrendQuerySchema
>;

export type TransitionExpenseReportStageRequest = z.infer<
    typeof TransitionExpenseReportStageInboundRequestSchema
>;

export type CaseQueueStageRollup = z.infer<typeof CaseQueueStageRollupSchema>;

export type FinanceDashboardTrendSpendBucket = z.infer<
    typeof FinanceDashboardTrendSpendBucketSchema
>;

export type FinanceDashboardTrendPoint = z.infer<
    typeof FinanceDashboardTrendPointSchema
>;

export type IdempotentSubmissionHeader = z.infer<
    typeof IdempotentSubmissionHeaderSchema
>;

export type AuditEntryResponse = z.infer<
    typeof AuditEntryOutboundResponseSchema
>;
