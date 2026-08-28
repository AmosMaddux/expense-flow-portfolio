import { describe, expect, test } from "vitest";
import { TraceFlags, trace } from "@opentelemetry/api";

import {
    formatXRayTraceHeader,
    parentContextFromXRayHeader,
    parseXRayTraceHeader,
    traceIdToXRayRoot,
} from "./xrayTrace.js";

const knownTraceId = "5759e988bd862e3fe1be46a994272793";
const knownParentSpanId = "53995c3f42cd8ad8";
const knownHeader =
    "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
const formattedSpanContext = {
    traceId: knownTraceId,
    spanId: knownParentSpanId,
    traceFlags: TraceFlags.SAMPLED,
    traceState: {
        get: () => undefined,
        keys: () => [],
        serialize: () => "",
        set: () => undefined,
        unset: () => undefined,
    },
} as const;

describe("xrayTrace", () => {
    test("parses a valid AWS trace header", () => {
        expect(parseXRayTraceHeader(knownHeader)).toStrictEqual({
            traceId: knownTraceId,
            parentSpanId: knownParentSpanId,
            sampled: true,
        });
    });

    test("treats a malformed root as missing context", () => {
        expect(
            parseXRayTraceHeader(
                "Root=broken;Parent=53995c3f42cd8ad8;Sampled=1",
            ),
        ).toBeUndefined();
        expect(
            trace.getSpanContext(parentContextFromXRayHeader("Root=broken")),
        ).toBeUndefined();
    });

    test("creates a root span context when the header has no parent span id", () => {
        const context = parentContextFromXRayHeader(
            "Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=0;Lineage=1:2",
        );
        const spanContext = trace.getSpanContext(context);

        expect(spanContext).toMatchObject({
            traceId: knownTraceId,
            traceFlags: TraceFlags.NONE,
        });
        expect(spanContext?.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    test("formats a span context back into an X-Ray header", () => {
        expect(
            formatXRayTraceHeader(
                formattedSpanContext as unknown as Parameters<
                    typeof formatXRayTraceHeader
                >[0],
            ),
        ).toBe(knownHeader);
        expect(traceIdToXRayRoot(knownTraceId)).toBe(
            "1-5759e988-bd862e3fe1be46a994272793",
        );
    });
});
