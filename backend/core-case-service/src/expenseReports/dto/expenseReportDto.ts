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

const mileageEntryRequestShape = {
    route: z.string().trim().min(3).max(500),
    distance: z
        .number()
        .positive("Distance must be greater than zero.")
        .max(999999.99)
        .multipleOf(0.01),
    mileageDate: z.iso.date(),
};

/**
 * Builds mileage request validation against a testable current-date clock.
 */
export function createMileageEntryInboundRequestSchema(
    now: () => Date = () => new Date(),
) {
    return z
        .object(mileageEntryRequestShape)
        .strict()
        .superRefine((request, context) => {
            const currentUtcDate = now().toISOString().slice(0, 10);
            if (request.mileageDate > currentUtcDate) {
                context.addIssue({
                    code: "custom",
                    message: "Mileage date cannot be in the future.",
                    path: ["mileageDate"],
                });
            }
        });
}

export const CreateMileageEntryInboundRequestSchema =
    createMileageEntryInboundRequestSchema();

export const expenseCategories = ["Travel", "Meals", "Lodging"] as const;
export const receiptContentTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
] as const;

const DraftLineItemInboundSchema = z
    .object({
        merchant: z.string().trim().min(1).max(240),
        expenseDate: z.iso.date(),
        category: z.enum(expenseCategories),
        amount: z.number().positive().max(9_999_999_999.99).multipleOf(0.01),
        currency: z.literal("USD"),
    })
    .strict();

const DraftReceiptInboundSchema = z
    .object({
        lineItemIndex: z.number().int().nonnegative(),
        uploadId: z.uuid(),
        filename: z.string().trim().min(1).max(255),
        contentType: z.enum(receiptContentTypes),
        sizeBytes: z
            .number()
            .int()
            .positive()
            .max(10 * 1024 * 1024),
    })
    .strict();

/**
 * Builds draft-content validation against a testable current-date clock.
 */
export function createAddDraftExpenseContentInboundRequestSchema(
    now: () => Date = () => new Date(),
) {
    return z
        .object({
            lineItems: z.array(DraftLineItemInboundSchema).min(1).max(50),
            receipts: z.array(DraftReceiptInboundSchema).max(50),
        })
        .strict()
        .superRefine((request, context) => {
            const currentUtcDate = now().toISOString().slice(0, 10);
            for (const [index, item] of request.lineItems.entries()) {
                if (item.expenseDate > currentUtcDate) {
                    context.addIssue({
                        code: "custom",
                        message: "Expense date cannot be in the future.",
                        path: ["lineItems", index, "expenseDate"],
                    });
                }
            }
            for (const [index, receipt] of request.receipts.entries()) {
                if (receipt.lineItemIndex >= request.lineItems.length) {
                    context.addIssue({
                        code: "custom",
                        message:
                            "Receipt must reference a submitted line item.",
                        path: ["receipts", index, "lineItemIndex"],
                    });
                }
            }
        });
}

export const AddDraftExpenseContentInboundRequestSchema =
    createAddDraftExpenseContentInboundRequestSchema();

export const ReceiptUploadParamsSchema = z
    .object({
        id: z.uuid(),
        uploadId: z.uuid(),
    })
    .strict();

export const ReceiptUploadMetadataInboundRequestSchema = z
    .object({
        filename: z.string().trim().min(1).max(255),
        contentType: z.enum(receiptContentTypes),
        sizeBytes: z
            .number()
            .int()
            .positive()
            .max(10 * 1024 * 1024),
    })
    .strict();

export const ReceiptUploadOutboundResponseSchema = z.object({
    uploadId: z.uuid(),
    filename: z.string(),
    contentType: z.enum(receiptContentTypes),
    sizeBytes: z.number().int().positive(),
});

export const AddDraftExpenseContentOutboundResponseSchema = z.object({
    expenseReportId: z.uuid(),
    lineItemIds: z.array(z.uuid()),
    receiptIds: z.array(z.uuid()),
});

export const DraftExpenseContentOutboundResponseSchema = z.object({
    expenseReportId: z.uuid(),
    lineItems: z.array(
        z.object({
            id: z.uuid(),
            merchant: z.string(),
            expenseDate: z.iso.date(),
            category: z.enum(expenseCategories),
            amount: z.number().nonnegative(),
            currency: z.literal("USD"),
        }),
    ),
    receipts: z.array(
        z.object({
            id: z.uuid(),
            filename: z.string().nullable(),
            merchant: z.string(),
            receiptDate: z.iso.date(),
            amount: z.number().nonnegative(),
        }),
    ),
    mileageEntries: z.array(
        z.object({
            id: z.uuid(),
            route: z.string(),
            distance: z.number().positive(),
            mileageDate: z.iso.date(),
            reimbursementAmount: z.number().nonnegative(),
        }),
    ),
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

export const ReadMySubmissionsInboundRequestSchema = z
    .object({
        tenantId: z.uuid(),
        ownerId: z.uuid(),
    })
    .strict();

export const ReadMySubmissionDetailInboundRequestSchema = z
    .object({
        id: z.uuid(),
        tenantId: z.uuid(),
        ownerId: z.uuid(),
    })
    .strict();

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

export const MySubmissionSchema = z.object({
    id: z.uuid(),
    dueDate: z.iso.date(),
    currentStage: z.enum(approvedWorkflowStages),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const MySubmissionListSchema = z.array(MySubmissionSchema);

export const MySubmissionDetailSchema = z.object({
    id: z.uuid(),
    currentStage: z.enum(approvedWorkflowStages),
    lineItems: z.array(
        z.object({
            id: z.uuid(),
            merchant: z.string(),
            expenseDate: z.iso.date(),
            category: z.string(),
            amount: z.number().nonnegative(),
            currency: z.string(),
        }),
    ),
    mileageEntries: z.array(
        z.object({
            id: z.uuid(),
            route: z.string(),
            distance: z.number().positive(),
            mileageDate: z.iso.date(),
            reimbursementAmount: z.number().nonnegative(),
            currency: z.literal("USD"),
        }),
    ),
});

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

export const mySubmissionListSchema = MySubmissionListSchema;

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

export type AddDraftExpenseContentRequest = z.infer<
    typeof AddDraftExpenseContentInboundRequestSchema
>;

export type AddDraftExpenseContentResponse = z.infer<
    typeof AddDraftExpenseContentOutboundResponseSchema
>;

export type ReceiptUploadMetadataRequest = z.infer<
    typeof ReceiptUploadMetadataInboundRequestSchema
>;

export type ReceiptUploadResponse = z.infer<
    typeof ReceiptUploadOutboundResponseSchema
>;

export type DraftExpenseContentResponse = z.infer<
    typeof DraftExpenseContentOutboundResponseSchema
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

export type ReadMySubmissionsParams = z.infer<
    typeof ReadMySubmissionsInboundRequestSchema
>;

export type MySubmission = z.infer<typeof MySubmissionSchema>;

export type ReadMySubmissionDetailParams = z.infer<
    typeof ReadMySubmissionDetailInboundRequestSchema
>;

export type MySubmissionDetail = z.infer<typeof MySubmissionDetailSchema>;

export type IdempotentSubmissionHeader = z.infer<
    typeof IdempotentSubmissionHeaderSchema
>;

export type AuditEntryResponse = z.infer<
    typeof AuditEntryOutboundResponseSchema
>;
