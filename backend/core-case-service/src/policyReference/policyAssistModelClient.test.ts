import { describe, expect, test, vi } from "vitest";

import {
    createPolicyAssistModelAnswer,
    type PolicyAssistModelOptions,
} from "./policyAssistModelClient.js";

const options: PolicyAssistModelOptions = {
    POLICY_ASSIST_API_KEY: "synthetic-policy-assist-key",
    POLICY_ASSIST_BASE_URL: "https://models.example.test/v1",
    POLICY_ASSIST_MODEL: "gpt-4o-mini",
    POLICY_ASSIST_TIMEOUT_MS: 30_000,
    POLICY_ASSIST_MAX_RETRIES: 0,
    POLICY_ASSIST_BASE_BACKOFF_MS: 0,
    POLICY_ASSIST_MAX_BACKOFF_MS: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function modelOutput(overrides: Record<string, unknown> = {}) {
    return {
        answer: "Synthetic Transit is potentially reimbursable with review.",
        answerSummary: "Potentially reimbursable with receipt and flag review.",
        reviewConclusion: "needs_review",
        reimbursabilityAssessment: {
            status: "potentially_reimbursable",
            reason: "Receipt metadata is present and policy context supports review.",
        },
        flagAssessmentNarrative:
            "The selected line item is over the $500.00 review threshold.",
        citations: ["tenant_expense_policy:synthetic-policy-hash:chunk-0"],
        abstained: false,
        expenseReportFindings: [
            {
                type: "policy_match",
                severity: "info",
                summary: "Receipt documentation is present.",
                relatedLineItemId: "50000000-0000-4000-8000-000000000001",
                citations: [
                    "tenant_expense_policy:synthetic-policy-hash:chunk-0",
                ],
            },
        ],
        findingBadges: [
            {
                type: "review_conclusion",
                label: "Needs review",
                tone: "warning",
            },
        ],
        policyEvidence: [
            {
                citation: "tenant_expense_policy:synthetic-policy-hash:chunk-0",
                summary: "Receipts are required for reimbursable expenses.",
            },
        ],
        missingInformation: [],
        recommendedNextActions: ["Review the line-item flag."],
        ...overrides,
    };
}

void describe("createPolicyAssistModelAnswer", () => {
    void test("posts a structured Responses API request with report and policy context", async () => {
        const fetchImplementation = vi.fn().mockResolvedValue(
            jsonResponse({
                output_text: JSON.stringify(modelOutput()),
            }),
        );

        const result = await createPolicyAssistModelAnswer(
            {
                question: "Is this reimbursable?",
                expenseReportContext: {
                    expenseReportId: "40000000-0000-4000-8000-000000000001",
                    currentStage: "AP Review",
                    priority: "Normal",
                    dueDate: "2026-08-31",
                    onHold: false,
                    selectedLineItemId: "50000000-0000-4000-8000-000000000001",
                    contextTruncation: {
                        lineItemsIncluded: 1,
                        lineItemsTotal: 2,
                        mileageEntriesIncluded: 0,
                        mileageEntriesTotal: 1,
                        receiptsIncluded: 1,
                        receiptsTotal: 1,
                        truncated: false,
                    },
                    lineItems: [
                        {
                            id: "50000000-0000-4000-8000-000000000001",
                            merchant: "Synthetic Transit",
                            category: "Travel",
                            date: "2026-08-24",
                            amount: "500.01",
                            currency: "USD",
                            glCode: "6100",
                            flaggedLineItem: true,
                            reviewAction: null,
                            deductible: null,
                        },
                    ],
                    mileageEntries: [],
                    receipts: [
                        {
                            id: "60000000-0000-4000-8000-000000000001",
                            lineItemId: "50000000-0000-4000-8000-000000000001",
                            merchant: "Synthetic Transit",
                            receiptDate: "2026-08-24",
                            amount: 500.01,
                            contentType: "application/pdf",
                            hasFile: true,
                        },
                    ],
                },
                policyContexts: [
                    {
                        citation:
                            "tenant_expense_policy:synthetic-policy-hash:chunk-0",
                        section: "Baseline policy",
                        content:
                            "Receipts are required for reimbursable expenses.",
                        score: 0,
                        source: "baseline",
                    },
                ],
            },
            { ...options, fetchImplementation },
        );

        expect(result.reviewConclusion).toBe("needs_review");
        const [endpoint, init] = fetchImplementation.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(endpoint).toBe("https://models.example.test/v1/responses");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>).Authorization).toBe(
            "Bearer synthetic-policy-assist-key",
        );
        expect(typeof init.body).toBe("string");
        const body = JSON.parse(init.body as string) as {
            input: Array<{ content: string }>;
            text: { format: { type: string; strict: boolean } };
        };
        expect(body.text.format).toMatchObject({
            type: "json_schema",
            strict: true,
        });
        expect(JSON.parse(body.input[0]?.content ?? "{}")).toMatchObject({
            question: "Is this reimbursable?",
            expenseReportContext: {
                selectedLineItemId: "50000000-0000-4000-8000-000000000001",
            },
            policyContexts: [
                {
                    citation:
                        "tenant_expense_policy:synthetic-policy-hash:chunk-0",
                    source: "baseline",
                },
            ],
        });
    });

    void test("throws a typed provider error for non-2xx responses", async () => {
        const fetchImplementation = vi
            .fn()
            .mockResolvedValue(
                jsonResponse({ error: "synthetic failure" }, 429),
            );

        await expect(
            createPolicyAssistModelAnswer(
                {
                    question: "Is this reimbursable?",
                    expenseReportContext: {
                        expenseReportId: "40000000-0000-4000-8000-000000000001",
                        currentStage: "AP Review",
                        priority: "Normal",
                        dueDate: "2026-08-31",
                        onHold: false,
                        selectedLineItemId: null,
                        contextTruncation: {
                            lineItemsIncluded: 0,
                            lineItemsTotal: 0,
                            mileageEntriesIncluded: 0,
                            mileageEntriesTotal: 0,
                            receiptsIncluded: 0,
                            receiptsTotal: 0,
                            truncated: false,
                        },
                        lineItems: [],
                        mileageEntries: [],
                        receipts: [],
                    },
                    policyContexts: [],
                },
                { ...options, fetchImplementation },
            ),
        ).rejects.toMatchObject({
            kind: "provider_rejected",
            statusCode: 429,
        });
    });
});
