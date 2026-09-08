import { z } from "zod";

export const alertDispositionSeverityValues = [
    "low",
    "medium",
    "high",
    "critical",
] as const;

export const alertDispositionStatusValues = [
    "investigated",
    "resolved",
    "monitoring",
    "escalated",
] as const;

export const CreateAlertDispositionInboundRequestSchema = z
    .object({
        alertId: z.string().trim().min(1).max(128),
        alertName: z.string().trim().min(1).max(200),
        source: z.string().trim().min(1).max(128),
        severity: z.enum(alertDispositionSeverityValues),
        status: z.enum(alertDispositionStatusValues).default("resolved"),
        resolution: z.string().trim().min(1).max(2_000),
        correlationId: z.uuid().optional(),
        traceId: z
            .string()
            .regex(/^[0-9a-f]{32}$/i)
            .optional(),
        notes: z.string().trim().max(4_000).optional(),
    })
    .strict();

export const AlertDispositionQuerySchema = z
    .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict();

export const AlertDispositionResponseSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    alertId: z.string(),
    alertName: z.string(),
    source: z.string(),
    severity: z.enum(alertDispositionSeverityValues),
    status: z.enum(alertDispositionStatusValues),
    resolution: z.string(),
    correlationId: z.uuid().nullable(),
    traceId: z.string().nullable(),
    investigatedBy: z.uuid(),
    notes: z.string().nullable(),
    resolvedAt: z.date().nullable(),
    createdAt: z.date(),
});

export const AlertDispositionListResponseSchema = z.array(
    AlertDispositionResponseSchema,
);

export type CreateAlertDispositionInboundRequest = z.infer<
    typeof CreateAlertDispositionInboundRequestSchema
>;
export type AlertDispositionQuery = z.infer<typeof AlertDispositionQuerySchema>;
export type AlertDispositionResponse = z.infer<
    typeof AlertDispositionResponseSchema
>;
