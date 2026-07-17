import { z } from "zod";

import { GlCodingServiceError } from "./glCodingErrors.js";

const expenseCategorySchema = z.enum([
    "Travel",
    "Meals",
    "Lodging",
    "Mileage",
    "Office Supplies",
    "Software",
    "Other",
]);

const glCodingLineItemRequestSchema = z.object({
    line_item_id: z.uuid(),
    merchant: z.string().min(1),
    amount: z.string().regex(/^\d{1,10}\.\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    category: expenseCategorySchema,
});

const glCodingMileageRequestSchema = z.object({
    mileage_entry_id: z.uuid(),
    route: z.string().min(1),
    distance: z.string().regex(/^\d{1,6}\.\d{2}$/),
    mileage_date: z.iso.date(),
});

export const GlCodingRequestSchema = z.object({
    line_items: z.array(glCodingLineItemRequestSchema),
    mileage: z.array(glCodingMileageRequestSchema),
});

const glAccountSchema = z.object({
    account_code: z.string().min(1),
    account_name: z.string().min(1),
});

const glCodedItemSchema = z.object({
    source_id: z.uuid(),
    source_type: z.enum(["line_item", "mileage"]),
    category: expenseCategorySchema,
    gl_account: glAccountSchema.nullable(),
    amount: z.string().nullable().optional(),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
    flagged_line_item: z.boolean(),
});

const glCodingFlagSchema = z.object({
    source_id: z.uuid(),
    source_type: z.enum(["line_item", "mileage"]),
    code: z.literal("line_item_over_threshold"),
    message: z.string().min(1),
});

export const GlCodingResponseSchema = z.object({
    coded_items: z.array(glCodedItemSchema),
    flags: z.array(glCodingFlagSchema),
});

export type GlCodingRequest = z.infer<typeof GlCodingRequestSchema>;
export type GlCodingResponse = z.infer<typeof GlCodingResponseSchema>;

/**
 * Requests GL account mappings and manual-review flags for expense line items.
 */
export async function codeExpenseLineItems(
    serviceBaseUrl: string,
    request: GlCodingRequest,
    fetchImplementation: typeof fetch = fetch,
): Promise<GlCodingResponse> {
    const requestBody = GlCodingRequestSchema.parse(request);
    const endpoint = `${serviceBaseUrl.replace(/\/$/, "")}/gl-coding/line-items`;

    let response: Response;
    try {
        response = await fetchImplementation(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
        });
    } catch (error: unknown) {
        throw new GlCodingServiceError(
            "The GL-coding service could not be reached.",
            undefined,
            { cause: error },
        );
    }

    if (!response.ok) {
        throw new GlCodingServiceError(
            "The GL-coding service rejected the coding request.",
            response.status,
        );
    }

    try {
        const responseBody: unknown = await response.json();
        return GlCodingResponseSchema.parse(responseBody);
    } catch (error: unknown) {
        throw new GlCodingServiceError(
            "The GL-coding service returned an invalid response.",
            response.status,
            { cause: error },
        );
    }
}
