import { z } from "zod";

import { NotFoundError } from "../errors/problem-json.js";
import { findExpenseReportReviewDetail } from "../expenseReports/repository/expenseReportRepository.js";
import {
    answerPolicyQuestion,
    type PolicyAnswer,
} from "./policyAssistantService.js";

export const AssistInboundRequestSchema = z
    .object({
        question: z.string().trim().min(1).max(2_000),
        caseContext: z
            .object({
                expenseReportId: z.uuid(),
                lineItemId: z.uuid().optional(),
            })
            .strict(),
    })
    .strict();

export const AssistOutboundResponseSchema = z
    .object({
        answer: z.string().min(1),
        citations: z.array(z.string().min(1)),
        contexts: z.array(
            z
                .object({
                    citation: z.string().min(1),
                    section: z.string().min(1),
                    content: z.string().min(1),
                    score: z.number(),
                })
                .strict(),
        ),
        refused: z.boolean(),
        abstained: z.boolean(),
        refusalCategory: z
            .enum(["prompt_disclosure", "cross_tenant", "instruction_override"])
            .nullable(),
        caseContext: z
            .object({
                expenseReportId: z.uuid(),
                lineItemId: z.uuid().nullable(),
            })
            .strict(),
        flagAssessment: z
            .object({
                amount: z.string().regex(/^-?\d+\.\d{2}$/),
                threshold: z.literal("500.00"),
                isFlagged: z.boolean(),
                rule: z.literal("line_item_amount_over_500"),
            })
            .strict()
            .nullable(),
    })
    .strict();

export type AssistInboundRequest = z.input<typeof AssistInboundRequestSchema>;
export type AssistResponse = z.infer<typeof AssistOutboundResponseSchema>;

type AssistRepository = {
    findExpenseReportReviewDetail: typeof findExpenseReportReviewDetail;
};

type PolicyAnswerer = (request: {
    tenantId: string;
    question: string;
    retrievalHints?: string[];
}) => Promise<PolicyAnswer>;

const categoryPolicyHints: Record<string, string> = {
    Travel: "travel airfare ground transportation",
    Meals: "meals entertainment business purpose",
    Lodging: "lodging accommodation receipts",
};
const defaultRepository: AssistRepository = { findExpenseReportReviewDetail };

/** Answers an internal policy question using an authenticated tenant's case context. */
export async function answerAssistQuestion(
    request: AssistInboundRequest & { tenantId: string },
    repository: AssistRepository = defaultRepository,
    answerer: PolicyAnswerer = answerPolicyQuestion,
): Promise<AssistResponse> {
    const parsed = AssistInboundRequestSchema.parse({
        question: request.question,
        caseContext: request.caseContext,
    });
    const detail = await repository.findExpenseReportReviewDetail(
        request.tenantId,
        parsed.caseContext.expenseReportId,
    );
    if (detail === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const lineItem =
        parsed.caseContext.lineItemId === undefined
            ? undefined
            : detail.lineItems.find(
                  (item) => item.id === parsed.caseContext.lineItemId,
              );
    if (parsed.caseContext.lineItemId !== undefined && lineItem === undefined) {
        throw new NotFoundError("Expense Report line item not found.");
    }

    // Stored case fields are retrieval data, never instruction-bearing question text.
    const policyAnswer = await answerer({
        tenantId: request.tenantId,
        question: parsed.question,
        ...(lineItem === undefined
            ? {}
            : {
                  retrievalHints: [
                      categoryPolicyHint(lineItem.category),
                      thresholdEvidenceHint,
                  ].filter((hint): hint is string => hint !== undefined),
              }),
    });
    const thresholdContexts =
        lineItem === undefined
            ? []
            : policyAnswer.contexts.filter(isThresholdEvidence);
    const thresholdCitations = policyAnswer.citations.filter((citation) =>
        thresholdContexts.some((context) => context.citation === citation),
    );
    const flagAssessment =
        lineItem === undefined || thresholdCitations.length === 0
            ? null
            : {
                  amount: lineItem.amount,
                  threshold: "500.00" as const,
                  isFlagged: isAmountOverFlagThreshold(lineItem.amount),
                  rule: "line_item_amount_over_500" as const,
              };
    return AssistOutboundResponseSchema.parse({
        answer: policyAnswer.answer,
        citations: policyAnswer.citations,
        contexts: policyAnswer.contexts,
        refused: policyAnswer.refused,
        abstained: policyAnswer.abstained,
        refusalCategory: policyAnswer.refusalCategory,
        caseContext: {
            expenseReportId: detail.expenseReportId,
            lineItemId: lineItem?.id ?? null,
        },
        flagAssessment,
    });
}

/** Maps a persisted category to a closed policy-retrieval taxonomy value. */
export function categoryPolicyHint(category: string): string | undefined {
    return categoryPolicyHints[category];
}
const thresholdEvidenceHint =
    "approval threshold flag over 500 dollars second review";

function isThresholdEvidence(
    context: PolicyAnswer["contexts"][number],
): boolean {
    const normalized = context.content.toLowerCase().replaceAll("$", "");
    const hasThreshold =
        /\b(over|above|exceeding|greater than)\s+(?:500(?:\.00)?|five hundred)(?:\s+dollars)?\b/u.test(
            normalized,
        );
    return (
        hasThreshold &&
        /(flag|second[-\s]+(pair[-\s]+)?review)/u.test(normalized)
    );
}
/** Applies the MVP's deterministic line-item flag threshold without ML inference. */
export function isAmountOverFlagThreshold(amount: string): boolean {
    const match = /^(?<sign>-?)(?<whole>\d+)\.(?<fraction>\d{2})$/u.exec(
        amount,
    );
    if (match?.groups === undefined) {
        throw new Error("Line item amount must use two decimal places.");
    }

    const { fraction, sign, whole } = match.groups;
    if (fraction === undefined || sign === undefined || whole === undefined) {
        throw new Error("Line item amount must use two decimal places.");
    }

    const cents = BigInt(whole) * 100n + BigInt(fraction);
    return (sign === "-" ? -cents : cents) > 50_000n;
}
