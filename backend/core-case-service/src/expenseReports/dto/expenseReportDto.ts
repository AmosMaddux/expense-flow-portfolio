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

export const SubmitExpenseReportInboundRequestSchema = z.object({}).strict();

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

export const expenseReportResponseSchema = ExpenseReportOutboundResponseSchema;

export const readCaseQueueStageRollupsRequestSchema =
    ReadCaseQueueStageRollupsInboundRequestSchema;

export const readCaseQueueStageRollupsQuerySchema =
    ReadCaseQueueStageRollupsQuerySchema;

export const transitionExpenseReportStageRequestSchema =
    TransitionExpenseReportStageInboundRequestSchema;

export const caseQueueStageRollupSchema = CaseQueueStageRollupSchema;

export const caseQueueStageRollupListSchema = CaseQueueStageRollupListSchema;

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

export type SubmitExpenseReportRequest = z.infer<
    typeof SubmitExpenseReportInboundRequestSchema
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
