import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import { approvedWorkflowStages, priorityLevels } from "../schema/index.js";

extendZodWithOpenApi(z);

// Tenant scope and workflow stage are server-controlled, not client-supplied.
export const CreateExpenseReportInboundRequestSchema = z.object({
    owner: z.uuid(),
    dueDate: z.date(),
    priority: z.enum(priorityLevels).default("Normal"),
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

export const expenseReportResponseSchema = ExpenseReportOutboundResponseSchema;

export type CreateExpenseReportRequest = z.infer<
    typeof CreateExpenseReportInboundRequestSchema
>;

export type ExpenseReportResponse = z.infer<
    typeof ExpenseReportOutboundResponseSchema
>;
