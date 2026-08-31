import type { NextFunction, Request, Response } from "express";

import { logCoreCaseMetric } from "./coreCaseLogger.js";

const uuidLikePathSegmentPattern =
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;

function normalizePath(path: string): string {
    return path.replace(uuidLikePathSegmentPattern, "/:id");
}

/**
 * Emits a structured request metric when an HTTP response completes.
 */
export function httpRequestLoggingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    res.on("finish", () => {
        const tenantId = req.auth?.tenantId ?? "unknown";
        const route = normalizePath(
            req.originalUrl.split("?")[0] ?? req.originalUrl,
        );
        const traceId = req.tracing?.span.spanContext().traceId ?? "unknown";
        const correlationId = req.tracing?.correlationId ?? "unknown";
        const baseEvent = {
            environment: "sandbox",
            eventType: "http_request",
            correlationId,
            method: req.method,
            metricValue: 1,
            route,
            service: "core-case-service",
            tenantId,
            traceId,
        };

        logCoreCaseMetric({
            ...baseEvent,
            metricName: "HttpRequestCount",
            statusCode: res.statusCode,
        });

        if (res.statusCode >= 500) {
            logCoreCaseMetric({
                ...baseEvent,
                eventType: "http_error",
                metricName: "HttpErrorCount",
                statusCode: res.statusCode,
                outcome: "error",
            });
        }
    });

    next();
}
