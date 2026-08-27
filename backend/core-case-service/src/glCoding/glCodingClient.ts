import { z } from "zod";
import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";

import { GlCodingServiceError } from "./glCodingErrors.js";
import {
    buildDownstreamTraceHeader,
    isTracingEnabled,
    startChildSpan,
} from "../tracing.js";

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
    distance: z
        .string()
        .regex(/^\d{1,6}\.\d{2}$/)
        .refine((value) => Number(value) > 0, {
            message: "Mileage distance must be greater than zero.",
        }),
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
    mapping_status: z.enum(["mapped", "unmapped"]),
    gl_account: glAccountSchema.nullable(),
    amount: z.string().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    flagged_line_item: z.boolean(),
});

const glCodingFlagSchema = z.object({
    source_id: z.uuid(),
    source_type: z.enum(["line_item", "mileage"]),
    code: z.enum(["line_item_over_threshold", "mileage_over_threshold"]),
    message: z.string().min(1),
});

export const GlCodingResponseSchema = z.object({
    coded_items: z.array(glCodedItemSchema),
    flags: z.array(glCodingFlagSchema),
});

export type GlCodingRequest = z.infer<typeof GlCodingRequestSchema>;
export type GlCodingResponse = z.infer<typeof GlCodingResponseSchema>;

export type GlCodingClientOptions = {
    accessToken?: string;
    delayImplementation?: (milliseconds: number) => Promise<void>;
    fetchImplementation?: typeof fetch;
    maxBackoffMs?: number;
    maxRetries?: number;
    random?: () => number;
    signal?: AbortSignal;
    timeoutMs?: number;
    baseBackoffMs?: number;
    parentSpan?: Span;
    correlationId?: string;
};

/**
 * Requests GL account mappings and manual-review flags for expense line items.
 */
export async function codeExpenseLineItems(
    serviceBaseUrl: string,
    request: GlCodingRequest,
    options: GlCodingClientOptions = {},
): Promise<GlCodingResponse> {
    const requestBody = GlCodingRequestSchema.parse(request);
    const endpoint = `${serviceBaseUrl.replace(/\/$/, "")}/gl-coding/line-items`;
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const maxRetries = options.maxRetries ?? 0;
    const delay = options.delayImplementation ?? defaultDelay;
    const random = options.random ?? Math.random;
    const tracingEnabled = isTracingEnabled();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 5_000);
        const signal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;
        const span =
            tracingEnabled && options.parentSpan !== undefined
                ? startChildSpan(
                      "core-case-service",
                      options.parentSpan,
                      "POST /gl-coding/line-items",
                      {
                          "http.method": "POST",
                          "http.url": endpoint,
                          "service.name": "core-case-service",
                      },
                  )
                : undefined;
        const traceHeader = buildDownstreamTraceHeader(span);

        let response: Response;
        try {
            response = await fetchImplementation(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.accessToken === undefined
                        ? {}
                        : { Authorization: `Bearer ${options.accessToken}` }),
                    ...(options.correlationId === undefined
                        ? {}
                        : { "x-correlation-id": options.correlationId }),
                    ...(traceHeader === undefined
                        ? {}
                        : { "X-Amzn-Trace-Id": traceHeader }),
                },
                body: JSON.stringify(requestBody),
                signal,
            });
        } catch (error: unknown) {
            span?.setAttribute("gl_coding.retry_attempt", attempt);
            span?.setStatus({
                code: SpanStatusCode.ERROR,
                message:
                    error instanceof Error
                        ? error.message
                        : "The GL-coding service could not be reached.",
            });
            span?.end();

            if (attempt < maxRetries && options.signal?.aborted !== true) {
                await delay(calculateRetryDelay(attempt, options, random));
                continue;
            }

            if (timeoutSignal.aborted) {
                throw new GlCodingServiceError(
                    "The GL-coding service request timed out.",
                    undefined,
                    { cause: error },
                );
            }

            throw new GlCodingServiceError(
                signal.aborted
                    ? "The GL-coding service request was cancelled."
                    : "The GL-coding service could not be reached.",
                undefined,
                { cause: error },
            );
        }

        span?.setAttribute("http.status_code", response.status);
        if (!response.ok) {
            span?.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${response.status}`,
            });
            span?.end();

            if (attempt < maxRetries && isRetryableStatus(response.status)) {
                await delay(calculateRetryDelay(attempt, options, random));
                continue;
            }

            throw new GlCodingServiceError(
                "The GL-coding service rejected the coding request.",
                response.status,
            );
        }

        try {
            const responseBody: unknown = await response.json();
            span?.setStatus({ code: SpanStatusCode.OK });
            span?.end();
            return GlCodingResponseSchema.parse(responseBody);
        } catch (error: unknown) {
            span?.setStatus({
                code: SpanStatusCode.ERROR,
                message:
                    error instanceof Error
                        ? error.message
                        : "The GL-coding service returned an invalid response.",
            });
            span?.end();

            if (timeoutSignal.aborted) {
                throw new GlCodingServiceError(
                    "The GL-coding service request timed out.",
                    response.status,
                    { cause: error },
                );
            }

            throw new GlCodingServiceError(
                "The GL-coding service returned an invalid response.",
                response.status,
                { cause: error },
            );
        }
    }

    throw new GlCodingServiceError("The GL-coding service request failed.");
}

function isRetryableStatus(statusCode: number): boolean {
    return statusCode === 429 || statusCode >= 500;
}

function calculateRetryDelay(
    attempt: number,
    options: GlCodingClientOptions,
    random: () => number,
): number {
    const baseBackoffMs = options.baseBackoffMs ?? 100;
    const maxBackoffMs = options.maxBackoffMs ?? 1_000;
    const exponentialDelay = Math.min(
        maxBackoffMs,
        baseBackoffMs * 2 ** attempt,
    );

    return Math.floor(exponentialDelay / 2 + random() * (exponentialDelay / 2));
}

async function defaultDelay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
