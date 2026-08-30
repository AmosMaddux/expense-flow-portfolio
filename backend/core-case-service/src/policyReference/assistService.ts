import { z } from "zod";

import { NotFoundError } from "../errors/problem-json.js";
import { findExpenseReportReviewDetail } from "../expenseReports/repository/expenseReportRepository.js";
import {
    buildAssistPolicyContextBundle,
    type AssistPolicyContext,
    type AssistPolicyContextRepository,
} from "./assistPolicyContext.js";
import {
    answerPolicyQuestion,
    type PolicyAnswer,
} from "./policyAssistantService.js";
import {
    createOptionalPolicyAssistModelAnswerer,
    type PolicyAssistModelAnswer,
} from "./policyAssistModelClient.js";
import { findTenantPolicyCorpusChunks } from "./policyCorpusRepository.js";
import { findTenantExpensePolicy } from "./policyReferenceRepository.js";

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
                    source: z.enum(["baseline", "retrieved"]),
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
        expenseReportFindings: z.array(
            z
                .object({
                    type: z.enum([
                        "policy_match",
                        "missing_receipt",
                        "amount_threshold",
                        "deductibility_review",
                        "insufficient_context",
                    ]),
                    severity: z.enum(["info", "warning"]),
                    summary: z.string().min(1).max(500),
                    relatedLineItemId: z.uuid().nullable(),
                    citations: z.array(z.string().min(1)),
                })
                .strict(),
        ),
        recommendedNextActions: z.array(z.string().min(1).max(240)).max(5),
        policyRetrievalStatus: z.enum([
            "baseline_and_retrieved",
            "baseline_only",
            "retrieved_only",
            "empty",
        ]),
        modelInvoked: z.boolean(),
        baselineContextCount: z.number().int().nonnegative(),
        retrievedContextCount: z.number().int().nonnegative(),
    })
    .strict();

export type AssistInboundRequest = z.input<typeof AssistInboundRequestSchema>;
export type AssistResponse = z.infer<typeof AssistOutboundResponseSchema>;
export type ExpenseReportFinding =
    AssistResponse["expenseReportFindings"][number];
export type NormalizedExpenseReportContext = ReturnType<
    typeof buildExpenseReportContext
>;

type AssistRepository = {
    findExpenseReportReviewDetail: typeof findExpenseReportReviewDetail;
} & AssistPolicyContextRepository;

type PolicyAnswerer = (request: {
    tenantId: string;
    question: string;
    topK?: number;
    retrievalHints?: string[];
}) => Promise<PolicyAnswer>;
type PolicyAssistModelAnswerer = (request: {
    question: string;
    expenseReportContext: NormalizedExpenseReportContext;
    policyContexts: AssistPolicyContext[];
}) => Promise<PolicyAssistModelAnswer>;

const categoryPolicyHints: Record<string, string> = {
    Travel: "travel airfare ground transportation",
    Meals: "meals entertainment business purpose",
    Lodging: "lodging accommodation receipts",
};
const assistPolicyTopK = 8;
const generalRetrievalHint =
    "reimbursable business purpose receipt documentation flags approval threshold deductibility review";
const defaultRepository: AssistRepository = {
    findExpenseReportReviewDetail,
    findTenantPolicyCorpusChunks,
    findTenantExpensePolicy,
};

/** Answers an internal policy question using an authenticated tenant's case context. */
export async function answerAssistQuestion(
    request: AssistInboundRequest & { tenantId: string },
    repository: AssistRepository = defaultRepository,
    answerer: PolicyAnswerer = answerPolicyQuestion,
    modelAnswerer:
        | PolicyAssistModelAnswerer
        | undefined = createOptionalPolicyAssistModelAnswerer(),
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
    const expenseReportContext = buildExpenseReportContext(
        detail,
        lineItem?.id ?? null,
    );

    // Stored case fields are retrieval data, never instruction-bearing question text.
    const policyAnswer = await answerer({
        tenantId: request.tenantId,
        question: parsed.question,
        topK: assistPolicyTopK,
        retrievalHints: [
            generalRetrievalHint,
            ...(lineItem === undefined
                ? []
                : [
                      categoryPolicyHint(lineItem.category),
                      thresholdEvidenceHint,
                  ]),
        ].filter((hint): hint is string => hint !== undefined),
    });
    const policyContextBundle = policyAnswer.refused
        ? {
              baselinePolicyContexts: [],
              retrievedPolicyContexts: [],
              policyContexts: [],
              policyRetrievalStatus: "empty" as const,
          }
        : await buildAssistPolicyContextBundle(
              request.tenantId,
              policyAnswer.contexts,
              repository,
          );
    const modelAnswer =
        policyAnswer.refused || policyContextBundle.policyContexts.length === 0
            ? undefined
            : await modelAnswerer?.({
                  question: parsed.question,
                  expenseReportContext,
                  policyContexts: policyContextBundle.policyContexts,
              });
    const groundedModelAnswer =
        modelAnswer === undefined
            ? undefined
            : groundModelAnswer(
                  modelAnswer,
                  policyContextBundle.policyContexts,
                  expenseReportContext,
              );
    const flagAssessment =
        lineItem === undefined
            ? null
            : {
                  amount: lineItem.amount,
                  threshold: "500.00" as const,
                  isFlagged: isAmountOverFlagThreshold(lineItem.amount),
                  rule: "line_item_amount_over_500" as const,
              };
    const expenseReportFindings =
        groundedModelAnswer?.expenseReportFindings ??
        fallbackExpenseReportFindings(flagAssessment);
    return AssistOutboundResponseSchema.parse({
        answer: groundedModelAnswer?.answer ?? policyAnswer.answer,
        citations: groundedModelAnswer?.citations ?? policyAnswer.citations,
        contexts: policyContextBundle.policyContexts,
        refused: policyAnswer.refused,
        abstained: groundedModelAnswer?.abstained ?? policyAnswer.abstained,
        refusalCategory: policyAnswer.refusalCategory,
        caseContext: {
            expenseReportId: detail.expenseReportId,
            lineItemId: lineItem?.id ?? null,
        },
        flagAssessment,
        expenseReportFindings,
        recommendedNextActions:
            groundedModelAnswer?.recommendedNextActions ??
            fallbackRecommendedNextActions(expenseReportFindings),
        policyRetrievalStatus: policyContextBundle.policyRetrievalStatus,
        modelInvoked: modelAnswer !== undefined,
        baselineContextCount: policyContextBundle.baselinePolicyContexts.length,
        retrievedContextCount:
            policyContextBundle.retrievedPolicyContexts.length,
    });
}

/** Maps a persisted category to a closed policy-retrieval taxonomy value. */
export function categoryPolicyHint(category: string): string | undefined {
    return categoryPolicyHints[category];
}

/** Builds a minimal report snapshot for the model without receipt files or secrets. */
export function buildExpenseReportContext(
    detail: Awaited<ReturnType<typeof findExpenseReportReviewDetail>>,
    selectedLineItemId: string | null,
) {
    if (detail === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return {
        expenseReportId: detail.expenseReportId,
        currentStage: detail.status,
        priority: detail.priority,
        dueDate: detail.dueDate,
        onHold: detail.onHold,
        selectedLineItemId,
        lineItems: detail.lineItems.map((item) => ({
            id: item.id,
            merchant: item.merchant,
            category: item.category,
            date: item.date,
            amount: item.amount,
            currency: item.currency,
            glCode: item.glCode,
            flaggedLineItem: item.flaggedLineItem,
            reviewAction: item.reviewAction,
            deductible: item.deductible,
        })),
        mileageEntries: detail.mileageEntries.map((entry) => ({
            id: entry.id,
            route: entry.route,
            distance: entry.distance,
            date: entry.date,
            amount: entry.amount,
            currency: entry.currency,
            glCode: entry.glCode,
            flaggedLineItem: entry.flaggedLineItem,
            reviewAction: entry.reviewAction,
            deductible: entry.deductible,
        })),
        receipts: detail.receipts.map((receipt) => ({
            id: receipt.id,
            lineItemId: receipt.lineItemId,
            merchant: receipt.merchant,
            receiptDate: receipt.receiptDate,
            amount: receipt.amount,
            contentType: receipt.contentType,
            hasFile: true,
        })),
    };
}
const thresholdEvidenceHint =
    "approval threshold flag over 500 dollars second review";
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

function groundModelAnswer(
    modelAnswer: PolicyAssistModelAnswer,
    policyContexts: readonly AssistPolicyContext[],
    expenseReportContext: NormalizedExpenseReportContext,
): PolicyAssistModelAnswer | undefined {
    const allowedCitations = new Set(
        policyContexts.map((context) => context.citation),
    );
    const citations = modelAnswer.citations.filter((citation) =>
        allowedCitations.has(citation),
    );
    if (!modelAnswer.abstained && citations.length === 0) {
        return undefined;
    }

    const lineItemIds = new Set(
        expenseReportContext.lineItems.map((item) => item.id),
    );
    return {
        answer: modelAnswer.answer,
        citations,
        abstained: modelAnswer.abstained,
        expenseReportFindings: modelAnswer.expenseReportFindings.map(
            (finding) => ({
                ...finding,
                relatedLineItemId:
                    finding.relatedLineItemId !== null &&
                    lineItemIds.has(finding.relatedLineItemId)
                        ? finding.relatedLineItemId
                        : null,
                citations: finding.citations.filter((citation) =>
                    allowedCitations.has(citation),
                ),
            }),
        ),
        recommendedNextActions: modelAnswer.recommendedNextActions,
    };
}

function fallbackExpenseReportFindings(
    flagAssessment: AssistResponse["flagAssessment"],
): ExpenseReportFinding[] {
    if (flagAssessment === null) {
        return [];
    }

    return [
        {
            type: "amount_threshold",
            severity: flagAssessment.isFlagged ? "warning" : "info",
            summary: `${flagAssessment.amount} is ${flagAssessment.isFlagged ? "over" : "not over"} the $500.00 line-item flag threshold.`,
            relatedLineItemId: null,
            citations: [],
        },
    ];
}

function fallbackRecommendedNextActions(
    findings: ExpenseReportFinding[],
): string[] {
    return findings.some((finding) => finding.severity === "warning")
        ? ["Review the cited policy source before taking workflow action."]
        : [];
}
