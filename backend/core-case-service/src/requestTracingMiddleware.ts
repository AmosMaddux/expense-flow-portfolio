import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SpanKind } from "@opentelemetry/api";

import { buildSpanName, finishSpan, getTracer } from "./tracing.js";
import {
    formatXRayTraceHeader,
    parentContextFromXRayHeader,
} from "./xrayTrace.js";

/**
 * Creates request tracing middleware that carries X-Ray context through Core Case.
 */
export function createRequestTracingMiddleware(
    serviceName: string,
): RequestHandler {
    const tracer = getTracer(serviceName);

    return (req: Request, res: Response, next: NextFunction): void => {
        const incomingTraceHeader = req.get("x-amzn-trace-id");
        const parentContext = parentContextFromXRayHeader(incomingTraceHeader);
        const span = tracer.startSpan(
            buildSpanName(
                req.method,
                req.originalUrl.split("?")[0] ?? req.originalUrl,
            ),
            {
                kind: SpanKind.SERVER,
                attributes: {
                    "http.method": req.method,
                    "http.target": req.originalUrl,
                    "service.name": serviceName,
                },
            },
            parentContext,
        );

        req.tracing = {
            span,
            traceHeader: formatXRayTraceHeader(span.spanContext()),
        };

        let ended = false;
        const finalize = (): void => {
            if (ended) {
                return;
            }

            ended = true;
            finishSpan(span, res.statusCode);
        };

        res.once("finish", finalize);
        res.once("close", finalize);
        next();
    };
}
