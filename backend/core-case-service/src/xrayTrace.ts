import { randomBytes } from "node:crypto";

import {
    ROOT_CONTEXT,
    TraceFlags,
    trace,
    type SpanContext,
} from "@opentelemetry/api";

const xrayRootPattern = /^1-([0-9a-f]{8})-([0-9a-f]{24})$/i;
const xrayFieldPattern = /(?:^|;)\s*([^=;]+)=([^;]+)/g;
const xraySpanIdPattern = /^[0-9a-f]{16}$/i;

export type XRayTraceContext = {
    traceId: string;
    parentSpanId: string | undefined;
    sampled: boolean;
};

/**
 * Parses an incoming X-Amzn-Trace-Id header into an OpenTelemetry parent context.
 */
export function parseXRayTraceHeader(
    value: string | undefined,
): XRayTraceContext | undefined {
    if (value === undefined || value.trim() === "") {
        return undefined;
    }

    const fields = new Map<string, string>();
    for (const match of value.matchAll(xrayFieldPattern)) {
        const key = match[1]?.trim();
        const rawValue = match[2]?.trim();
        if (key === undefined || rawValue === undefined) {
            continue;
        }

        fields.set(key, rawValue);
    }

    const root = fields.get("Root");
    const rootMatch = root?.match(xrayRootPattern);
    if (rootMatch === null || rootMatch === undefined) {
        return undefined;
    }

    const parentSpanId = fields.get("Parent");

    return {
        traceId: `${rootMatch[1]}${rootMatch[2]}`.toLowerCase(),
        parentSpanId:
            parentSpanId !== undefined && xraySpanIdPattern.test(parentSpanId)
                ? parentSpanId.toLowerCase()
                : undefined,
        sampled: fields.get("Sampled") !== "0",
    };
}

/**
 * Formats a span context as an X-Ray header for downstream HTTP calls.
 */
export function formatXRayTraceHeader(
    spanContext: SpanContext,
    sampled = true,
): string {
    return [
        `Root=${traceIdToXRayRoot(spanContext.traceId)}`,
        `Parent=${spanContext.spanId}`,
        `Sampled=${sampled ? "1" : "0"}`,
    ].join(";");
}

/**
 * Converts an OpenTelemetry trace ID to an X-Ray root header value.
 */
export function traceIdToXRayRoot(traceId: string): string {
    if (!/^[0-9a-f]{32}$/i.test(traceId)) {
        throw new Error("Trace ID must be a 32-character hexadecimal string.");
    }

    return `1-${traceId.slice(0, 8).toLowerCase()}-${traceId
        .slice(8)
        .toLowerCase()}`;
}

/**
 * Creates a parent context for a span from an X-Ray header, or the root context.
 */
export function parentContextFromXRayHeader(
    header: string | undefined,
): ReturnType<typeof trace.setSpanContext> {
    const parsed = parseXRayTraceHeader(header);
    if (parsed === undefined) {
        return ROOT_CONTEXT;
    }

    return trace.setSpanContext(ROOT_CONTEXT, {
        traceId: parsed.traceId,
        spanId: parsed.parentSpanId ?? generateSpanId(),
        traceFlags: parsed.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    });
}

/**
 * Generates a valid 16-character OpenTelemetry span ID.
 */
export function generateSpanId(): string {
    return randomBytes(8).toString("hex");
}
