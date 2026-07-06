import { z } from "zod";

import { approvedWorkflowStages, priorityLevels } from "../db/schema/index.js";

export const createExpenseReportRequestSchema = z.object({
    tenantId: z.uuid(),
    owner: z.uuid(),
    dueDate: z.iso.date(),
    priority: z.enum(priorityLevels).default("Normal"),
});

export const expenseReportResponseSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    owner: z.uuid(),
    dueDate: z.iso.date(),
    priority: z.enum(priorityLevels),
    currentStage: z.enum(approvedWorkflowStages),
    onHold: z.boolean(),
    holdReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

export type CreateExpenseReportRequest = z.infer<
    typeof createExpenseReportRequestSchema
>;

export type ExpenseReportResponse = z.infer<typeof expenseReportResponseSchema>;
