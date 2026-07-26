import { z } from "zod";

export const expenseCategories = ["Travel", "Meals", "Lodging"] as const;
export const receiptContentTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
] as const;

const receiptFileSchema = z
    .custom<File | null>(
        (value) =>
            value === null ||
            (typeof File !== "undefined" && value instanceof File),
        "Choose a valid receipt file.",
    )
    .refine((file) => file === null || file.size <= 10 * 1024 * 1024, {
        message: "Receipt must be 10 MB or smaller.",
    })
    .refine(
        (file) =>
            file === null ||
            receiptContentTypes.includes(
                file.type as (typeof receiptContentTypes)[number],
            ),
        { message: "Receipt must be a PDF, PNG, JPG, or WebP file." },
    );

export const submitExpenseFormSchema = z.object({
    lineItems: z
        .array(
            z.object({
                merchant: z
                    .string()
                    .trim()
                    .min(1, "Merchant is required.")
                    .max(240, "Merchant must be 240 characters or fewer."),
                expenseDate: z
                    .string()
                    .min(1, "Expense date is required.")
                    .refine(
                        (value) => z.iso.date().safeParse(value).success,
                        "Enter a valid expense date.",
                    ),
                category: z.enum(expenseCategories, {
                    error: "Choose a category.",
                }),
                amount: z.coerce
                    .number({ error: "Enter an amount." })
                    .positive("Amount must be greater than zero.")
                    .max(9_999_999_999.99, "Amount is too large.")
                    .multipleOf(0.01, "Use no more than two decimal places."),
                receipt: receiptFileSchema,
            }),
        )
        .max(50, "A report can contain at most 50 line items."),
});

export const draftExpenseReportSchema = z.object({
    id: z.uuid(),
    currentStage: z.literal("Drafted"),
});

export const assembledDraftSchema = z.object({
    expenseReportId: z.uuid(),
    lineItemIds: z.array(z.uuid()),
    receiptIds: z.array(z.uuid()),
});

export const receiptUploadResponseSchema = z.object({
    uploadId: z.uuid(),
    filename: z.string(),
    contentType: z.enum(receiptContentTypes),
    sizeBytes: z.number().int().positive(),
});

export const draftExpenseContentSchema = z.object({
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

export const submittedExpenseReportSchema = z.object({
    id: z.uuid(),
    currentStage: z.literal("Submitted"),
});

export type SubmitExpenseFormValues = z.output<typeof submitExpenseFormSchema>;
export type DraftExpenseContent = z.infer<typeof draftExpenseContentSchema>;
