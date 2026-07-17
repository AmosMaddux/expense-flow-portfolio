import { describe, expect, it } from "vitest";

import {
    codeExpenseLineItems,
    GlCodingRequestSchema,
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
