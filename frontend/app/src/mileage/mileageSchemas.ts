import { z } from "zod";

export const mileageFormSchema = z.object({
    mileageDate: z
        .string()
        .min(1, "Trip date is required.")
        .refine((value) => z.iso.date().safeParse(value).success, {
            message: "Enter a valid trip date.",
        }),
    routeFrom: z
        .string()
        .trim()
        .min(2, "Enter a starting point.")
        .max(240, "Starting point must be 240 characters or fewer."),
    routeTo: z
        .string()
        .trim()
        .min(2, "Enter a destination.")
        .max(240, "Destination must be 240 characters or fewer."),
    distance: z
        .number({ error: "Enter the trip distance." })
        .positive("Distance must be greater than zero.")
        .max(999999.99, "Distance is too large.")
        .multipleOf(0.01, "Use no more than two decimal places."),
});

export const expenseReportSchema = z.object({
    id: z.uuid(),
    currentStage: z.literal("Drafted"),
});

export const mileageConfigSchema = z.object({
    ratePerMile: z.number().positive(),
    currency: z.literal("USD"),
});

export const mileageEntrySchema = z.object({
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
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

export type MileageFormInput = z.input<typeof mileageFormSchema>;
export type MileageFormValues = z.output<typeof mileageFormSchema>;
export type MileageConfig = z.infer<typeof mileageConfigSchema>;
export type MileageEntry = z.infer<typeof mileageEntrySchema>;
