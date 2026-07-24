import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
    approvedWorkflowStages,
    priorityLevels,
} from "../../db/schema/index.js";

extendZodWithOpenApi(z);

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

export const CreateMileageEntryInboundRequestSchema = z
    .object({
        route: z.string().trim().min(3).max(500),
        distance: z
            .number()
            .positive("Distance must be greater than zero.")
            .max(999999.99)
            .multipleOf(0.01),
        mileageDate: z.iso.date(),
    })
    .strict();

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

export const MileageEntryOutboundResponseSchema = z.object({
    id: z.uuid(),
    expenseReportId: z.uuid(),
    route: z.string(),
    distance: z.number().positive(),
    mileageDate: z.iso.date(),
    reimbursement: z.object({
        ratePerMile: z.number().positive(),
        amount: z.number().nonnegative(),
        currency: z.literal("USD"),
    }),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const MileageConfigOutboundResponseSchema = z.object({
    ratePerMile: z.number().positive(),
    currency: z.literal("USD"),
});

export const CaseQueueStageRollupSchema = z.object({
    currentStage: z.enum(approvedWorkflowStages),
    reportCount: z.number().int().nonnegative(),
    overdueCount: z.number().int().nonnegative(),
});

export const CaseQueueStageRollupListSchema = z.array(
    CaseQueueStageRollupSchema,
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

export const transitionExpenseReportStageRequestSchema =
    TransitionExpenseReportStageInboundRequestSchema;

export const caseQueueStageRollupSchema = CaseQueueStageRollupSchema;

export const caseQueueStageRollupListSchema = CaseQueueStageRollupListSchema;

export const auditEntryResponseSchema = AuditEntryOutboundResponseSchema;

export const auditEntryListResponseSchema =
    AuditEntryListOutboundResponseSchema;

export type CreateExpenseReportRequest = z.infer<
    typeof CreateExpenseReportInboundRequestSchema
>;

export type GetExpenseReportRequest = z.infer<
    typeof GetExpenseReportInboundRequestSchema
>;

export type CreateMileageEntryRequest = z.infer<
    typeof CreateMileageEntryInboundRequestSchema
>;

export type MileageEntryResponse = z.infer<
    typeof MileageEntryOutboundResponseSchema
>;

export type MileageConfigResponse = z.infer<
    typeof MileageConfigOutboundResponseSchema
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

export type TransitionExpenseReportStageRequest = z.infer<
    typeof TransitionExpenseReportStageInboundRequestSchema
>;

export type CaseQueueStageRollup = z.infer<typeof CaseQueueStageRollupSchema>;

export type IdempotentSubmissionHeader = z.infer<
    typeof IdempotentSubmissionHeaderSchema
>;

export type AuditEntryResponse = z.infer<
    typeof AuditEntryOutboundResponseSchema
>;
