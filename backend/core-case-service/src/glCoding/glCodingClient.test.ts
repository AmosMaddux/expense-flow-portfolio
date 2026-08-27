import { describe, expect, it, vi } from "vitest";

import {
    codeExpenseLineItems,
    GlCodingRequestSchema,
    GlCodingResponseSchema,
    type GlCodingRequest,
} from "./glCodingClient.js";

const emptyRequest: GlCodingRequest = { line_items: [], mileage: [] };
const successResponse = {
    coded_items: [],
    flags: [],
};
const tracingModule = vi.hoisted(() => ({
    buildDownstreamTraceHeader: vi.fn<(span: unknown) => string | undefined>(
        () => undefined,
    ),
    isTracingEnabled: vi.fn<() => boolean>(() => false),
    startChildSpan: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock("../tracing.js", () => tracingModule);
type FetchProcedure = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

describe("GL-coding client", () => {
    it("sends tracing headers when a parent span is available", async () => {
        const fakeSpan = {
            end: vi.fn(),
            setAttribute: vi.fn(),
            setStatus: vi.fn(),
            spanContext: () => ({
                spanId: "2222222222222222",
                traceFlags: 1,
                traceId: "11111111111111111111111111111111",
                traceState: {
                    serialize: () => "",
                    set: () => undefined,
                    unset: () => undefined,
                    get: () => undefined,
                    keys: () => [],
                },
                isRemote: false,
            }),
        } as never;

        tracingModule.isTracingEnabled.mockReturnValue(true);
        tracingModule.startChildSpan.mockReturnValue(fakeSpan);
        tracingModule.buildDownstreamTraceHeader.mockReturnValue(
            "Root=1-11111111-111111111111111111111111;Parent=2222222222222222;Sampled=1",
        );
        const fetchImplementation = vi.fn<FetchProcedure>(() =>
            Promise.resolve(Response.json(successResponse)),
        );

        await codeExpenseLineItems(
            "http://gl-coding.example.test",
            emptyRequest,
            {
                correlationId: "70000000-0000-4000-8000-000000000123",
                fetchImplementation:
                    fetchImplementation as unknown as typeof fetch,
                parentSpan: {} as never,
            },
        );

        const call = fetchImplementation.mock.calls[0];
        expect(call?.[1]?.headers).toMatchObject({
            "X-Amzn-Trace-Id":
                "Root=1-11111111-111111111111111111111111;Parent=2222222222222222;Sampled=1",
            "x-correlation-id": "70000000-0000-4000-8000-000000000123",
        });
    });

    it("rejects a zero mileage distance", () => {
        expect(() =>
            GlCodingRequestSchema.parse({
                line_items: [],
                mileage: [
                    {
                        mileage_entry_id:
                            "30000000-0000-4000-8000-000000000201",
                        route: "Synthetic route",
                        distance: "0.00",
                        mileage_date: "2026-07-17",
                    },
                ],
            }),
        ).toThrow("Mileage distance must be greater than zero.");
    });

    it("accepts a flagged mileage reimbursement response", () => {
        const response = GlCodingResponseSchema.parse({
            coded_items: [
                {
                    source_id: "30000000-0000-4000-8000-000000000201",
                    source_type: "mileage",
                    category: "Mileage",
                    mapping_status: "mapped",
                    gl_account: {
                        account_code: "6300",
                        account_name: "Mileage Expense",
                    },
                    amount: "600.00",
                    currency: "USD",
                    flagged_line_item: true,
                },
            ],
            flags: [
                {
                    source_id: "30000000-0000-4000-8000-000000000201",
                    source_type: "mileage",
                    code: "mileage_over_threshold",
                    message:
                        "Mileage reimbursement is above the MVP manual review threshold.",
                },
            ],
        });

        expect(response.flags[0]?.code).toBe("mileage_over_threshold");
    });

    it("aborts a GL-coding request after the configured timeout", async () => {
        const hangingFetch = (async (
            _input: string | URL | Request,
            init?: RequestInit,
        ): Promise<Response> => {
            await new Promise<void>((_resolve, reject) => {
                const signal = init?.signal;
                signal?.addEventListener(
                    "abort",
                    () => {
                        reject(
                            signal.reason instanceof Error
                                ? signal.reason
                                : new Error("The request was aborted."),
                        );
                    },
                    { once: true },
                );
            });

            throw new Error("The hanging request unexpectedly completed.");
        }) as typeof fetch;

        await expect(
            codeExpenseLineItems(
                "http://gl-coding.example.test",
                emptyRequest,
                {
                    fetchImplementation: hangingFetch,
                    timeoutMs: 1,
                },
            ),
        ).rejects.toMatchObject({
            message: "The GL-coding service request timed out.",
        });
    });

    it("sends a tenant-scoped bearer token when one is provided", async () => {
        const fetchImplementation = vi.fn<FetchProcedure>(() =>
            Promise.resolve(Response.json(successResponse)),
        );

        await codeExpenseLineItems(
            "http://gl-coding.example.test",
            emptyRequest,
            {
                accessToken: "synthetic-access-token",
                fetchImplementation:
                    fetchImplementation as unknown as typeof fetch,
            },
        );

        const call = fetchImplementation.mock.calls[0];
        expect(call?.[0]).toBe(
            "http://gl-coding.example.test/gl-coding/line-items",
        );
        expect(call?.[1]?.headers).toMatchObject({
            Authorization: "Bearer synthetic-access-token",
            "Content-Type": "application/json",
        });
    });

    it("retries retryable HTTP failures with deterministic backoff", async () => {
        const delays: number[] = [];
        const fetchImplementation = vi
            .fn<FetchProcedure>()
            .mockResolvedValueOnce(
                new Response("service unavailable", { status: 503 }),
            )
            .mockResolvedValueOnce(
                new Response("too many requests", { status: 429 }),
            )
            .mockResolvedValueOnce(Response.json(successResponse));

        const response = await codeExpenseLineItems(
            "http://gl-coding.example.test",
            emptyRequest,
            {
                baseBackoffMs: 100,
                delayImplementation: (milliseconds) => {
                    delays.push(milliseconds);
                    return Promise.resolve();
                },
                fetchImplementation:
                    fetchImplementation as unknown as typeof fetch,
                maxRetries: 2,
                random: () => 0,
            },
        );

        expect(response).toEqual(successResponse);
        expect(fetchImplementation).toHaveBeenCalledTimes(3);
        expect(delays).toEqual([50, 100]);
    });

    it("retries network failures without exceeding the retry bound", async () => {
        const fetchImplementation = vi
            .fn<FetchProcedure>()
            .mockRejectedValueOnce(new Error("synthetic network failure"))
            .mockResolvedValueOnce(Response.json(successResponse));

        await expect(
            codeExpenseLineItems(
                "http://gl-coding.example.test",
                emptyRequest,
                {
                    delayImplementation: () => Promise.resolve(),
                    fetchImplementation:
                        fetchImplementation as unknown as typeof fetch,
                    maxRetries: 1,
                    random: () => 0,
                },
            ),
        ).resolves.toEqual(successResponse);

        expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    it("does not retry non-transient HTTP failures", async () => {
        const fetchImplementation = vi.fn<FetchProcedure>(() =>
            Promise.resolve(
                Response.json({ detail: "bad request" }, { status: 400 }),
            ),
        );

        await expect(
            codeExpenseLineItems(
                "http://gl-coding.example.test",
                emptyRequest,
                {
                    delayImplementation: () =>
                        Promise.reject(
                            new Error(
                                "Non-transient failures should not wait.",
                            ),
                        ),
                    fetchImplementation:
                        fetchImplementation as unknown as typeof fetch,
                    maxRetries: 2,
                },
            ),
        ).rejects.toMatchObject({
            message: "The GL-coding service rejected the coding request.",
            statusCode: 400,
        });

        expect(fetchImplementation).toHaveBeenCalledTimes(1);
    });
});
