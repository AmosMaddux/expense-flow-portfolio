import { randomUUID } from "node:crypto";

import {
    context,
    SpanKind,
    SpanStatusCode,
    trace,
    TraceFlags,
    type Span,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
    BasicTracerProvider,
    BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import { formatXRayTraceHeader } from "./xrayTrace.js";

let tracingEnabled = false;
let providerInitialized = false;

/**
 * Enables OTLP trace export when the collector endpoint is configured.
 */
export function initializeTracing(serviceName: string): void {
    if (providerInitialized) {
        return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
    if (endpoint === undefined || endpoint.length === 0) {
        providerInitialized = true;
        return;
    }

    const tracerProvider = new BasicTracerProvider({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
            "deployment.environment.name": "sandbox",
        }),
        spanProcessors: [
            new BatchSpanProcessor(
                new OTLPTraceExporter({ url: endpoint }) as never,
            ),
        ],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    tracingEnabled = true;
    providerInitialized = true;
}

/**
 * Returns whether trace export is enabled for this process.
 */
export function isTracingEnabled(): boolean {
    return tracingEnabled;
}

/**
 * Returns the shared tracer for one service.
 */
export function getTracer(serviceName: string) {
    initializeTracing(serviceName);
    return trace.getTracer(serviceName);
}

/**
 * Attaches a human-readable X-Ray trace header to a downstream request.
 */
export function buildDownstreamTraceHeader(
    span: Span | undefined,
): string | undefined {
    if (span === undefined) {
        return undefined;
    }

    const spanContext = span.spanContext();
    if (spanContext.traceId === "00000000000000000000000000000000") {
        return undefined;
    }

    return formatXRayTraceHeader(
        spanContext,
        (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
    );
}

/**
 * Creates a span name that remains stable enough for trace inspection.
 */
export function buildSpanName(
    method: string,
    path: string,
    suffix?: string,
): string {
    return suffix === undefined
        ? `${method} ${path}`
        : `${method} ${path} ${suffix}`;
}

/**
 * Generates a synthetic request identifier for trace fallback paths.
 */
export function createSyntheticRequestId(): string {
    return randomUUID();
}

/**
 * Starts a child span for a downstream call when tracing is enabled.
 */
export function startChildSpan(
    tracerName: string,
    parentSpan: Span | undefined,
    spanName: string,
    attributes: Record<string, string | number | boolean | undefined> = {},
): Span | undefined {
    if (!tracingEnabled || parentSpan === undefined) {
        return undefined;
    }

    const tracer = getTracer(tracerName);
    return tracer.startSpan(
        spanName,
        {
            kind: SpanKind.CLIENT,
            attributes: Object.fromEntries(
                Object.entries(attributes).filter(([, value]) => value !== undefined),
            ),
        },
        trace.setSpan(context.active(), parentSpan),
    );
}

/**
 * Finishes a span and marks errors using the HTTP status code when relevant.
 */
export function finishSpan(span: Span | undefined, statusCode: number): void {
    if (span === undefined) {
        return;
    }

    span.setAttribute("http.status_code", statusCode);
    if (statusCode >= 500) {
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
        });
    } else {
        span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
}

