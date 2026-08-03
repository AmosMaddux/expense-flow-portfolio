import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
    approvedWorkflowStages,
    lineItemReviewActions,
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

/**
 * Builds saved line-item update validation against a testable current-date clock.
 */
export function createUpdateDraftLineItemInboundRequestSchema(
    now: () => Date = () => new Date(),
) {
    return DraftLineItemInboundSchema.superRefine((request, context) => {
        const currentUtcDate = now().toISOString().slice(0, 10);
        if (request.expenseDate > currentUtcDate) {
            context.addIssue({
                code: "custom",
                message: "Expense date cannot be in the future.",
                path: ["expenseDate"],
            });
        }
    });
}

export const UpdateDraftLineItemInboundRequestSchema =
    createUpdateDraftLineItemInboundRequestSchema();

export const DraftExpenseSourceParamsSchema = z
    .object({
        id: z.uuid(),
        sourceId: z.uuid(),
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
            lineItemId: z.uuid().nullable(),
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

export const SettleExpenseReportInboundRequestSchema = z
    .object({
        reason: z.string().trim().min(1).optional(),
    })
    .strict();

export const StageTransitionCorrelationHeaderSchema = z
    .object({
        correlationId: z.uuid().optional(),
    })
    .strict();

export const ClearExpenseReportFlagsInboundRequestSchema = z
    .object({
        sourceIds: z.array(z.uuid()).min(1),
        reason: z.string().trim().min(1),
    })
    .strict();

export const ReviewExpenseReportLineItemInboundRequestSchema = z
    .object({
        action: z.enum(lineItemReviewActions),
        reason: z.string().trim().min(1).optional(),
    })
    .strict()
    .superRefine((request, context) => {
        if (request.action === "reject" && request.reason === undefined) {
            context.addIssue({
                code: "custom",
                message: "Line-item rejection requires a reason.",
                path: ["reason"],
            });
        }
    });

export const ReviewExpenseReportLineItemParamsSchema = z.object({
    id: z.uuid(),
    sourceId: z.uuid(),
});

export const ReviewExpenseReportSourceParamsSchema = z.object({
    id: z.uuid(),
    sourceType: z.enum(["line_item", "mileage"]),
    sourceId: z.uuid(),
});

export const UpdateExpenseReportSourceDeductibilityInboundRequestSchema = z
    .object({
        deductible: z.boolean(),
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

const ReadAllTransactionsFilterSchema = z.object({
    category: z.string().trim().min(1).optional(),
    status: z.enum(approvedWorkflowStages).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
        .string()
        .trim()
        .min(1)
        .refine(isValidAllTransactionsCursor)
        .optional(),
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

function isValidTransactionDateRange(request: {
    startDate?: string | undefined;
    endDate?: string | undefined;
}): boolean {
    return (
        request.startDate === undefined ||
        request.endDate === undefined ||
        request.startDate <= request.endDate
    );
}

function isValidAllTransactionsCursor(cursor: string): boolean {
    try {
        const parsed = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8"),
        ) as unknown;

        return (
            parsed !== null &&
            typeof parsed === "object" &&
            "expenseDate" in parsed &&
            "id" in parsed &&
            typeof parsed.expenseDate === "string" &&
            z.iso.date().safeParse(parsed.expenseDate).success &&
            z.uuid().safeParse(parsed.id).success
        );
    } catch {
        return false;
    }
}

export const ReadAllTransactionsInboundRequestSchema =
    ReadAllTransactionsFilterSchema.extend({
        tenantId: z.uuid(),
    })
        .strict()
        .refine(isValidTransactionDateRange, {
            message: "startDate must be on or before endDate.",
            path: ["startDate"],
        });

export const ReadAllTransactionsQuerySchema =
    ReadAllTransactionsFilterSchema.strict().refine(
        isValidTransactionDateRange,
        {
            message: "startDate must be on or before endDate.",
            path: ["startDate"],
        },
    );

export const ReadMySubmissionsInboundRequestSchema = z
    .object({
        tenantId: z.uuid(),
        ownerId: z.uuid(),
        cursor: z.string().max(512).optional(),
        pageSize: z.number().int().min(1).max(50),
    })
    .strict();

export const ReadMySubmissionsQuerySchema = z
    .object({
        cursor: z
            .string()
            .trim()
            .min(1)
            .max(512)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional(),
        pageSize: z.coerce.number().int().min(1).max(50).default(25),
    })
    .strict();

export const MySubmissionsCursorSchema = z
    .object({
        updatedAt: z.iso.datetime({ offset: true }),
        createdAt: z.iso.datetime({ offset: true }),
        id: z.uuid(),
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
    correlationId: z.uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
    eventId: z.uuid().optional(),
    occurredAt: z.date().optional(),
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

export const SubmitExpenseReportOperationResultSchema = z.object({
    correlationId: z.uuid(),
    report: ExpenseReportOutboundResponseSchema.extend({
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    }),
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

export const AllTransactionSchema = z.object({
    id: z.uuid(),
    expenseReportId: z.uuid(),
    date: z.string().datetime({ offset: true }),
    merchant: z.string().min(1),
    category: z.string().min(1),
    amount: z.string().regex(/^-?\d+\.\d{2}$/),
    currency: z.string().min(3).max(3),
    status: z.enum(approvedWorkflowStages),
    deductible: z.boolean().nullable(),
    owner: z.uuid(),
    priority: z.enum(priorityLevels),
    dueDate: z.iso.date(),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    glCode: z.string().nullable(),
    flaggedLineItem: z.boolean(),
    reviewAction: z.enum(lineItemReviewActions).nullable(),
});

export const AllTransactionListSchema = z.array(AllTransactionSchema);

export const AllTransactionPageSchema = z.object({
    items: AllTransactionListSchema,
    nextCursor: z.string().nullable(),
});

const ExpenseReportReviewDetailSourceSchema = z.object({
    id: z.uuid(),
    date: z.iso.date(),
    amount: z.string().regex(/^-?\d+\.\d{2}$/),
    currency: z.string().min(3).max(3),
    glCode: z.string().nullable(),
    flaggedLineItem: z.boolean(),
    reviewAction: z.enum(lineItemReviewActions).nullable(),
    deductible: z.boolean().nullable(),
});

export const ExpenseReportReviewDetailSchema = z.object({
    expenseReportId: z.uuid(),
    owner: z.uuid(),
    priority: z.enum(priorityLevels),
    dueDate: z.iso.date(),
    status: z.enum(approvedWorkflowStages),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    lineItems: z.array(
        ExpenseReportReviewDetailSourceSchema.extend({
            merchant: z.string().min(1),
            category: z.string().min(1),
        }),
    ),
    mileageEntries: z.array(
        ExpenseReportReviewDetailSourceSchema.extend({
            route: z.string().min(1),
            distance: z.string().regex(/^\d+\.\d{2}$/),
        }),
    ),
});

export const MySubmissionSchema = z.object({
    id: z.uuid(),
    dueDate: z.iso.date(),
    currentStage: z.enum(approvedWorkflowStages),
    isSentBack: z.boolean(),
    onHold: z.boolean(),
    isOverdue: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const MySubmissionListSchema = z.array(MySubmissionSchema);

export const MySubmissionPageSchema = z.object({
    items: MySubmissionListSchema,
    nextCursor: z.string().nullable(),
});

export const MySubmissionDetailSchema = z.object({
    id: z.uuid(),
    currentStage: z.enum(approvedWorkflowStages),
    rejectionReason: z.string().nullable(),
    lineItems: z.array(
        z.object({
            id: z.uuid(),
            merchant: z.string(),
            expenseDate: z.iso.date(),
            category: z.string(),
            amount: z.number().nonnegative(),
            currency: z.string(),
            reviewAction: z.enum(lineItemReviewActions).nullable(),
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
            reviewAction: z.enum(lineItemReviewActions).nullable(),
        }),
    ),
});
const PolicyCheckOutboundResponseSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    state: z.enum(["cleared", "uncleared"]),
});

export const ApprovalQueueMileageEntryOutboundResponseSchema = z.object({
    id: z.uuid(),
    expenseReportId: z.uuid(),
    route: z.string().min(1),
    distance: z.coerce.number().positive(),
    mileageDate: z.iso.date(),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    flaggedLineItem: z.boolean(),
    policyChecks: z.array(PolicyCheckOutboundResponseSchema),
    reviewAction: z.enum(lineItemReviewActions).nullable(),
    deductible: z.boolean(),
});

export const ApprovalQueueReceiptOutboundResponseSchema = z.object({
    id: z.uuid(),
    lineItemId: z.uuid().nullable(),
    merchant: z.string().min(1),
    receiptDate: z.iso.date(),
    amount: z.coerce.number().nonnegative().openapi({
        type: "number",
        minimum: 0,
    }),
    filename: z.string().nullable(),
    contentType: z.string().nullable(),
});

export const ApprovalQueueLineItemOutboundResponseSchema = z.object({
    id: z.uuid(),
    sourceType: z.enum(["line_item", "mileage"]),
    expenseReportId: z.uuid(),
    employee: z.uuid(),
    merchant: z.string().min(1),
    amount: z.coerce.number().nonnegative(),
    glCode: z.string().min(1),
    currentStage: z.enum(approvedWorkflowStages),
    flaggedLineItem: z.boolean(),
    policyChecks: z.array(PolicyCheckOutboundResponseSchema),
    reviewAction: z.enum(lineItemReviewActions).nullable(),
    deductible: z.boolean(),
    canAdvance: z.boolean(),
    reportTotalMileage: z.coerce.number().nonnegative(),
    mileageEntries: z.array(ApprovalQueueMileageEntryOutboundResponseSchema),
    receipts: z.array(ApprovalQueueReceiptOutboundResponseSchema),
});

export const ApprovalQueueLineItemListOutboundResponseSchema = z.array(
    ApprovalQueueLineItemOutboundResponseSchema,
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

export const settleExpenseReportRequestSchema =
    SettleExpenseReportInboundRequestSchema;

export const clearExpenseReportFlagsRequestSchema =
    ClearExpenseReportFlagsInboundRequestSchema;

export const reviewExpenseReportLineItemRequestSchema =
    ReviewExpenseReportLineItemInboundRequestSchema;

export const reviewExpenseReportLineItemParamsSchema =
    ReviewExpenseReportLineItemParamsSchema;

export const reviewExpenseReportSourceParamsSchema =
    ReviewExpenseReportSourceParamsSchema;

export const updateExpenseReportSourceDeductibilityRequestSchema =
    UpdateExpenseReportSourceDeductibilityInboundRequestSchema;

export const expenseReportResponseSchema = ExpenseReportOutboundResponseSchema;

export const expenseReportReviewDetailSchema = ExpenseReportReviewDetailSchema;

export const readCaseQueueStageRollupsRequestSchema =
    ReadCaseQueueStageRollupsInboundRequestSchema;

export const readCaseQueueStageRollupsQuerySchema =
    ReadCaseQueueStageRollupsQuerySchema;

export const readFinanceDashboardTrendRequestSchema =
    ReadFinanceDashboardTrendInboundRequestSchema;

export const readFinanceDashboardTrendQuerySchema =
    ReadFinanceDashboardTrendQuerySchema;

export const readAllTransactionsRequestSchema =
    ReadAllTransactionsInboundRequestSchema;

export const readAllTransactionsQuerySchema = ReadAllTransactionsQuerySchema;

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

export const allTransactionSchema = AllTransactionSchema;

export const allTransactionListSchema = AllTransactionListSchema;

export const allTransactionPageSchema = AllTransactionPageSchema;

export const mySubmissionListSchema = MySubmissionListSchema;

export const mySubmissionPageSchema = MySubmissionPageSchema;

export const mySubmissionDetailSchema = MySubmissionDetailSchema;

export const approvalQueueLineItemResponseSchema =
    ApprovalQueueLineItemOutboundResponseSchema;

export const approvalQueueLineItemListResponseSchema =
    ApprovalQueueLineItemListOutboundResponseSchema;

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

export type UpdateDraftLineItemRequest = z.infer<
    typeof UpdateDraftLineItemInboundRequestSchema
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

export type SettleExpenseReportRequest = z.infer<
    typeof SettleExpenseReportInboundRequestSchema
>;

export type StageTransitionCorrelationHeader = z.infer<
    typeof StageTransitionCorrelationHeaderSchema
>;

export type ClearExpenseReportFlagsRequest = z.infer<
    typeof ClearExpenseReportFlagsInboundRequestSchema
>;

export type ReviewExpenseReportLineItemRequest = z.infer<
    typeof ReviewExpenseReportLineItemInboundRequestSchema
>;

export type ReviewExpenseReportLineItemParams = z.infer<
    typeof ReviewExpenseReportLineItemParamsSchema
>;

export type ReviewExpenseReportSourceParams = z.infer<
    typeof ReviewExpenseReportSourceParamsSchema
>;

export type UpdateExpenseReportSourceDeductibilityRequest = z.infer<
    typeof UpdateExpenseReportSourceDeductibilityInboundRequestSchema
>;

export type ExpenseReportResponse = z.infer<
    typeof ExpenseReportOutboundResponseSchema
>;

export type ExpenseReportReviewDetail = z.infer<
    typeof ExpenseReportReviewDetailSchema
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

export type ReadAllTransactionsParams = z.input<
    typeof ReadAllTransactionsInboundRequestSchema
>;

export type ParsedReadAllTransactionsParams = z.infer<
    typeof ReadAllTransactionsInboundRequestSchema
>;

export type ReadAllTransactionsQuery = z.infer<
    typeof ReadAllTransactionsQuerySchema
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

export type AllTransaction = z.infer<typeof AllTransactionSchema>;

export type AllTransactionPage = z.infer<typeof AllTransactionPageSchema>;

export type ReadMySubmissionsParams = z.infer<
    typeof ReadMySubmissionsInboundRequestSchema
>;

export type ReadMySubmissionsQuery = z.infer<
    typeof ReadMySubmissionsQuerySchema
>;

export type MySubmission = z.infer<typeof MySubmissionSchema>;

export type MySubmissionPage = z.infer<typeof MySubmissionPageSchema>;

export type ReadMySubmissionDetailParams = z.infer<
    typeof ReadMySubmissionDetailInboundRequestSchema
>;

export type MySubmissionDetail = z.infer<typeof MySubmissionDetailSchema>;

export type ApprovalQueueLineItemResponse = z.infer<
    typeof ApprovalQueueLineItemOutboundResponseSchema
>;

export type IdempotentSubmissionHeader = z.infer<
    typeof IdempotentSubmissionHeaderSchema
>;

export type AuditEntryResponse = z.infer<
    typeof AuditEntryOutboundResponseSchema
>;
