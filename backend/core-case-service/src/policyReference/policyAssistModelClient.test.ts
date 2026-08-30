import { describe, expect, test, vi } from "vitest";

import { createPolicyAssistModelAnswer } from "./policyAssistModelClient.js";

const lineItemId = "50000000-0000-4000-8000-000000000001";

void describe("createPolicyAssistModelAnswer", () => {
    void test("posts structured report and policy context to the Responses API", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        output_text: JSON.stringify({
                            answer: "The receipt policy applies.",
                            citations: ["policy:receipts"],
                            abstained: false,
                            expenseReportFindings: [
                                {
                                    type: "policy_match",
                                    severity: "info",
                                    summary:
                                        "The selected line item has a matching receipt.",
                                    relatedLineItemId: lineItemId,
                                    citations: ["policy:receipts"],
                                },
                            ],
                            recommendedNextActions: [
                                "Compare the receipt amount with the line item.",
                            ],
                        }),
                    }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                ),
            ),
        );

        const answer = await createPolicyAssistModelAnswer(
            {
                question: "Does this receipt satisfy policy?",
                expenseReportContext: {
                    expenseReportId: "40000000-0000-4000-8000-000000000001",
                    currentStage: "AP Review",
                    priority: "Normal",
                    dueDate: "2026-08-30",
                    onHold: false,
                    selectedLineItemId: lineItemId,
                    lineItems: [
                        {
                            id: lineItemId,
                            merchant: "Synthetic Transit",
                            category: "Travel",
                            date: "2026-08-24",
                            amount: "42.00",
                            currency: "USD",
                            glCode: "6100",
                            flaggedLineItem: false,
                            reviewAction: null,
                            deductible: null,
                        },
                    ],
                    mileageEntries: [],
                    receipts: [
                        {
                            id: "60000000-0000-4000-8000-000000000001",
                            lineItemId,
                            merchant: "Synthetic Transit",
                            receiptDate: "2026-08-24",
                            amount: 42,
                            contentType: "application/pdf",
                            hasFile: true,
                        },
                    ],
                },
                policyContexts: [
                    {
                        citation: "policy:receipts",
                        section: "Receipts",
                        content: "Receipts are required for transit expenses.",
                        score: 1,
                    },
                ],
            },
            {
                apiKey: "synthetic-openai-key",
                baseBackoffMs: 1,
                baseUrl: "https://api.openai.com/v1",
                maxBackoffMs: 1,
                maxRetries: 0,
                model: "gpt-4o-mini",
                timeoutMs: 30_000,
                fetchImplementation,
            },
        );

        expect(answer.answer).toBe("The receipt policy applies.");
        const [url, init] = fetchImplementation.mock.calls[0] ?? [];
        expect(url).toBe("https://api.openai.com/v1/responses");
        expect(init?.headers).toMatchObject({
            Authorization: "Bearer synthetic-openai-key",
            "Content-Type": "application/json",
        });
        if (typeof init?.body !== "string") {
            throw new Error("Expected a JSON request body.");
        }
        const body = JSON.parse(init.body) as {
            input: Array<{ content: string }>;
            model: string;
            store: boolean;
            text: { format: { type: string; strict: boolean } };
        };
        expect(body.model).toBe("gpt-4o-mini");
        expect(body.store).toBe(false);
        expect(body.text.format).toMatchObject({
            type: "json_schema",
            strict: true,
        });
        expect(JSON.parse(body.input[0]?.content ?? "{}")).toMatchObject({
            question: "Does this receipt satisfy policy?",
            expenseReportContext: {
                selectedLineItemId: lineItemId,
            },
            policyContexts: [
                {
                    citation: "policy:receipts",
                },
            ],
        });
    });
});
