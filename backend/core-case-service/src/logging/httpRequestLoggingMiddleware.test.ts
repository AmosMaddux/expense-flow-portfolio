import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

const logCoreCaseMetricMock = vi.hoisted(() => vi.fn());

vi.mock("./coreCaseLogger.js", () => ({
    logCoreCaseMetric: logCoreCaseMetricMock,
}));

import { httpRequestLoggingMiddleware } from "./httpRequestLoggingMiddleware.js";

function buildResponse(statusCode: number): Response {
    const listeners: Record<string, Array<() => void>> = {};
    return {
        on(event: string, handler: () => void) {
            listeners[event] ??= [];
            listeners[event].push(handler);
            return this;
        },
        emit(event: string) {
            for (const handler of listeners[event] ?? []) {
                handler();
            }
        },
        statusCode,
    } as unknown as Response;
}

void describe("httpRequestLoggingMiddleware", () => {
    test("emits request and error metrics for 5xx responses", () => {
        const req = {
            method: "GET",
            originalUrl: "/v1/expense-reports/60000000-0000-4000-8000-000000000001/transitions?foo=bar",
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000001",
            },
        } as unknown as Request;
        const res = buildResponse(500);
        const next = vi.fn() as NextFunction;

        httpRequestLoggingMiddleware(req, res, next);
        (res as unknown as { emit: (event: string) => void }).emit("finish");

        expect(next).toHaveBeenCalledOnce();
        expect(logCoreCaseMetricMock).toHaveBeenCalledWith(
            expect.objectContaining({
                metricName: "HttpRequestCount",
                route: "/v1/expense-reports/:id/transitions",
                tenantId: "40000000-0000-4000-8000-000000000001",
            }),
        );
        expect(logCoreCaseMetricMock).toHaveBeenCalledWith(
            expect.objectContaining({
                metricName: "HttpErrorCount",
                route: "/v1/expense-reports/:id/transitions",
                tenantId: "40000000-0000-4000-8000-000000000001",
            }),
        );
    });
});
