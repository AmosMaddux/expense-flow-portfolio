import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
    approvedWorkflowStages,
    priorityLevels,
} from "../../db/schema/index.js";

extendZodWithOpenApi(z);

export const CreateExpenseReportInboundRequestSchema = z.object({
    tenant_id: z.uuid(),
    owner: z.uuid(),
    dueDate: z.iso.date(),
    priority: z.enum(priorityLevels).default("Normal"),
});

export const TenantContextInboundRequestSchema = z.object({
    tenantId: z.uuid(),
});

export const GetExpenseReportInboundRequestSchema = z.object({
    id: z.uuid(),
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

export const createExpenseReportRequestSchema =
    CreateExpenseReportInboundRequestSchema;

export const getExpenseReportRequestSchema =
    GetExpenseReportInboundRequestSchema;

export const expenseReportResponseSchema = ExpenseReportOutboundResponseSchema;

export type CreateExpenseReportRequest = z.infer<
    typeof CreateExpenseReportInboundRequestSchema
>;

export type TenantContextRequest = z.infer<
    typeof TenantContextInboundRequestSchema
>;

export type GetExpenseReportRequest = z.infer<
    typeof GetExpenseReportInboundRequestSchema
>;

export type ExpenseReportResponse = z.infer<
    typeof ExpenseReportOutboundResponseSchema
>;
