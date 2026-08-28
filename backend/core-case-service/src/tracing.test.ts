import { describe, expect, test, vi } from "vitest";
import { TraceFlags, type Span } from "@opentelemetry/api";

import { buildDownstreamTraceHeader } from "./tracing.js";

describe("tracing", () => {
    test("buildDownstreamTraceHeader returns undefined without a span", () => {
        expect(buildDownstreamTraceHeader(undefined)).toBeUndefined();
    });

    test("buildDownstreamTraceHeader formats a sampled span context", () => {
        const span = {
            spanContext: () => ({
                traceId: "5759e988bd862e3fe1be46a994272793",
                spanId: "53995c3f42cd8ad8",
                traceFlags: TraceFlags.SAMPLED,
                traceState: {
                    get: vi.fn(),
                    keys: vi.fn(() => []),
                    serialize: vi.fn(() => ""),
                    set: vi.fn(),
                    unset: vi.fn(),
                },
                isRemote: false,
            }),
        } as unknown as Span;

        expect(buildDownstreamTraceHeader(span)).toBe(
            "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1",
        );
    });

    test("buildDownstreamTraceHeader omits an all-zero trace id", () => {
        const span = {
            spanContext: () => ({
                traceId: "00000000000000000000000000000000",
                spanId: "53995c3f42cd8ad8",
                traceFlags: TraceFlags.SAMPLED,
                traceState: {
                    get: vi.fn(),
                    keys: vi.fn(() => []),
                    serialize: vi.fn(() => ""),
                    set: vi.fn(),
                    unset: vi.fn(),
                },
                isRemote: false,
            }),
        } as unknown as Span;

        expect(buildDownstreamTraceHeader(span)).toBeUndefined();
    });
});
