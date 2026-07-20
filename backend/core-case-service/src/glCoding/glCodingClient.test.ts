import { describe, expect, it } from "vitest";

import {
    codeExpenseLineItems,
    GlCodingRequestSchema,
    GlCodingResponseSchema,
    type GlCodingRequest,
} from "./glCodingClient.js";

const emptyRequest: GlCodingRequest = { line_items: [], mileage: [] };

describe("GL-coding client", () => {
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
                        reject(signal.reason);
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
});
