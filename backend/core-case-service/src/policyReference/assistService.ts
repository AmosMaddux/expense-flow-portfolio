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
        answerSummary: z.string().min(1).max(1_000),
        reviewConclusion: z.enum([
            "potentially_reimbursable",
            "not_reimbursable",
            "needs_review",
            "insufficient_context",
        ]),
        reimbursabilityAssessment: z
            .object({
                status: z.enum([
                    "potentially_reimbursable",
                    "not_reimbursable",
                    "needs_more_info",
                ]),
                reason: z.string().min(1).max(1_000),
            })
            .strict(),
        flagAssessmentNarrative: z.string().min(1).max(1_000).nullable(),
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
        findingBadges: z.array(
            z
                .object({
                    type: z.enum([
                        "policy_match",
                        "missing_receipt",
                        "amount_threshold",
                        "deductibility_review",
                        "insufficient_context",
                        "review_conclusion",
                        "policy_context",
                        "model_status",
                    ]),
                    label: z.string().min(1).max(80),
                    tone: z.enum([
                        "neutral",
                        "info",
                        "success",
                        "warning",
                        "danger",
                    ]),
                })
                .strict(),
        ),
        policyEvidence: z.array(
            z
                .object({
                    summary: z.string().min(1).max(500),
                    citation: z.string().min(1),
                })
                .strict(),
        ),
        missingInformation: z.array(z.string().min(1).max(240)).max(5),
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
type FindingBadge = AssistResponse["findingBadges"][number];
type PolicyEvidence = AssistResponse["policyEvidence"][number];
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
    const fallbackReview = buildFallbackReviewResponse(
        policyAnswer,
        policyContextBundle.policyContexts,
        expenseReportContext,
        flagAssessment,
        modelAnswer !== undefined,
    );
    const expenseReportFindings =
        groundedModelAnswer?.expenseReportFindings ??
        fallbackReview.expenseReportFindings;
    return AssistOutboundResponseSchema.parse({
        answer: groundedModelAnswer?.answer ?? fallbackReview.answer,
        answerSummary:
            groundedModelAnswer?.answerSummary ?? fallbackReview.answerSummary,
        reviewConclusion:
            groundedModelAnswer?.reviewConclusion ??
            fallbackReview.reviewConclusion,
        reimbursabilityAssessment:
            groundedModelAnswer?.reimbursabilityAssessment ??
            fallbackReview.reimbursabilityAssessment,
        flagAssessmentNarrative:
            groundedModelAnswer?.flagAssessmentNarrative ??
            fallbackReview.flagAssessmentNarrative,
        citations: groundedModelAnswer?.citations ?? fallbackReview.citations,
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
            fallbackReview.recommendedNextActions,
        findingBadges:
            groundedModelAnswer?.findingBadges ?? fallbackReview.findingBadges,
        policyEvidence:
            groundedModelAnswer?.policyEvidence ??
            fallbackReview.policyEvidence,
        missingInformation:
            groundedModelAnswer?.missingInformation ??
            fallbackReview.missingInformation,
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
        answerSummary: modelAnswer.answerSummary,
        reviewConclusion: modelAnswer.reviewConclusion,
        reimbursabilityAssessment: modelAnswer.reimbursabilityAssessment,
        flagAssessmentNarrative: modelAnswer.flagAssessmentNarrative,
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
        findingBadges: modelAnswer.findingBadges,
        policyEvidence: modelAnswer.policyEvidence.filter((evidence) =>
            allowedCitations.has(evidence.citation),
        ),
        missingInformation: modelAnswer.missingInformation,
        recommendedNextActions: modelAnswer.recommendedNextActions,
    };
}

function buildFallbackReviewResponse(
    policyAnswer: PolicyAnswer,
    policyContexts: readonly AssistPolicyContext[],
    expenseReportContext: NormalizedExpenseReportContext,
    flagAssessment: AssistResponse["flagAssessment"],
    modelInvoked: boolean,
): Pick<
    AssistResponse,
    | "answer"
    | "answerSummary"
    | "reviewConclusion"
    | "reimbursabilityAssessment"
    | "flagAssessmentNarrative"
    | "citations"
    | "expenseReportFindings"
    | "findingBadges"
    | "policyEvidence"
    | "missingInformation"
    | "recommendedNextActions"
> {
    const selectedLineItem = selectedLineItemFor(expenseReportContext);
    const selectedReceipts =
        selectedLineItem === undefined
            ? []
            : expenseReportContext.receipts.filter(
                  (receipt) => receipt.lineItemId === selectedLineItem.id,
              );
    const reportFlaggedLineItems = expenseReportContext.lineItems.filter(
        (lineItem) =>
            lineItem.flaggedLineItem ||
            isAmountOverFlagThreshold(lineItem.amount),
    );
    const findings = fallbackExpenseReportFindings(
        flagAssessment,
        selectedLineItem,
        selectedReceipts.length > 0,
    );
    const policyEvidence = fallbackPolicyEvidence(policyContexts);
    const citations =
        policyAnswer.citations.length > 0
            ? policyAnswer.citations
            : policyEvidence.map((evidence) => evidence.citation);
    const reviewConclusion = resolveReviewConclusion(
        selectedLineItem,
        selectedReceipts.length > 0,
        flagAssessment,
        reportFlaggedLineItems.length,
        policyAnswer,
    );
    const reimbursabilityAssessment = resolveReimbursabilityAssessment(
        selectedLineItem,
        selectedReceipts.length > 0,
        policyEvidence.length,
        policyAnswer,
    );
    const flagAssessmentNarrative = resolveFlagAssessmentNarrative(
        flagAssessment,
        reportFlaggedLineItems.length,
    );
    const answerSummary = buildFallbackAnswerSummary(
        reviewConclusion,
        reimbursabilityAssessment.reason,
        flagAssessmentNarrative,
        policyAnswer,
    );

    return {
        answer: answerSummary,
        answerSummary,
        reviewConclusion,
        reimbursabilityAssessment,
        flagAssessmentNarrative,
        citations,
        expenseReportFindings: findings,
        findingBadges: fallbackFindingBadges({
            reviewConclusion,
            selectedLineItem,
            hasSelectedReceipt: selectedReceipts.length > 0,
            flagAssessment,
            policyEvidenceCount: policyEvidence.length,
            modelInvoked,
        }),
        policyEvidence,
        missingInformation: fallbackMissingInformation(
            selectedLineItem,
            selectedReceipts.length > 0,
            policyEvidence.length,
            policyAnswer,
        ),
        recommendedNextActions: fallbackRecommendedNextActions(findings),
    };
}

function selectedLineItemFor(
    expenseReportContext: NormalizedExpenseReportContext,
): NormalizedExpenseReportContext["lineItems"][number] | undefined {
    if (expenseReportContext.selectedLineItemId === null) {
        return undefined;
    }

    return expenseReportContext.lineItems.find(
        (lineItem) => lineItem.id === expenseReportContext.selectedLineItemId,
    );
}

function fallbackExpenseReportFindings(
    flagAssessment: AssistResponse["flagAssessment"],
    selectedLineItem?: NormalizedExpenseReportContext["lineItems"][number],
    hasSelectedReceipt = false,
): ExpenseReportFinding[] {
    const findings: ExpenseReportFinding[] = [];

    if (flagAssessment !== null) {
        findings.push({
            type: "amount_threshold",
            severity: flagAssessment.isFlagged ? "warning" : "info",
            summary: `${flagAssessment.amount} is ${flagAssessment.isFlagged ? "over" : "not over"} the $500.00 line-item flag threshold.`,
            relatedLineItemId: selectedLineItem?.id ?? null,
            citations: [],
        });
    }

    if (selectedLineItem !== undefined && !hasSelectedReceipt) {
        findings.push({
            type: "missing_receipt",
            severity: "warning",
            summary:
                "The selected line item does not have receipt metadata attached.",
            relatedLineItemId: selectedLineItem.id,
            citations: [],
        });
    }

    if (selectedLineItem?.deductible === null) {
        findings.push({
            type: "deductibility_review",
            severity: "info",
            summary:
                "Deductibility has not been marked for the selected line item.",
            relatedLineItemId: selectedLineItem.id,
            citations: [],
        });
    }

    return findings;
}

function fallbackRecommendedNextActions(
    findings: ExpenseReportFinding[],
): string[] {
    const actions: string[] = [];
    if (findings.some((finding) => finding.type === "amount_threshold")) {
        actions.push(
            "Review the line-item flag before taking workflow action.",
        );
    }
    if (findings.some((finding) => finding.type === "missing_receipt")) {
        actions.push("Request or verify receipt documentation.");
    }
    if (actions.length === 0 && findings.length > 0) {
        actions.push(
            "Review the Expense Report details before workflow action.",
        );
    }

    return actions.slice(0, 5);
}

function fallbackPolicyEvidence(
    policyContexts: readonly AssistPolicyContext[],
): PolicyEvidence[] {
    return policyContexts.slice(0, 3).map((context) => ({
        citation: context.citation,
        summary: `${context.section}: ${firstSentence(context.content)}`,
    }));
}

function resolveReviewConclusion(
    selectedLineItem:
        NormalizedExpenseReportContext["lineItems"][number] | undefined,
    hasSelectedReceipt: boolean,
    flagAssessment: AssistResponse["flagAssessment"],
    reportFlaggedLineItemCount: number,
    policyAnswer: PolicyAnswer,
): AssistResponse["reviewConclusion"] {
    if (policyAnswer.refused) {
        return "insufficient_context";
    }
    if (flagAssessment?.isFlagged || reportFlaggedLineItemCount > 0) {
        return "needs_review";
    }
    if (selectedLineItem !== undefined && !hasSelectedReceipt) {
        return "needs_review";
    }
    if (selectedLineItem !== undefined && hasSelectedReceipt) {
        return "potentially_reimbursable";
    }
    if (policyAnswer.abstained) {
        return "insufficient_context";
    }

    return "needs_review";
}

function resolveReimbursabilityAssessment(
    selectedLineItem:
        NormalizedExpenseReportContext["lineItems"][number] | undefined,
    hasSelectedReceipt: boolean,
    policyEvidenceCount: number,
    policyAnswer: PolicyAnswer,
): AssistResponse["reimbursabilityAssessment"] {
    if (policyAnswer.refused || policyAnswer.abstained) {
        return {
            status: "needs_more_info",
            reason: policyAnswer.answer,
        };
    }
    if (selectedLineItem === undefined) {
        return {
            status: "needs_more_info",
            reason: "Select a line item for a more specific reimbursability assessment.",
        };
    }
    if (!hasSelectedReceipt) {
        return {
            status: "needs_more_info",
            reason: "The selected line item needs receipt documentation before reimbursability can be assessed confidently.",
        };
    }

    return {
        status: "potentially_reimbursable",
        reason:
            policyEvidenceCount > 0
                ? "The selected line item has receipt metadata and policy context is available for reviewer validation."
                : "The selected line item has receipt metadata, but policy context is limited.",
    };
}

function resolveFlagAssessmentNarrative(
    flagAssessment: AssistResponse["flagAssessment"],
    reportFlaggedLineItemCount: number,
): string | null {
    if (flagAssessment !== null) {
        return `${flagAssessment.amount} is ${flagAssessment.isFlagged ? "over" : "not over"} the $500.00 line-item flag threshold.`;
    }
    if (reportFlaggedLineItemCount > 0) {
        return `${String(reportFlaggedLineItemCount)} line item${reportFlaggedLineItemCount === 1 ? "" : "s"} in this Expense Report need flag review.`;
    }

    return null;
}

function buildFallbackAnswerSummary(
    reviewConclusion: AssistResponse["reviewConclusion"],
    reimbursabilityReason: string,
    flagAssessmentNarrative: string | null,
    policyAnswer: PolicyAnswer,
): string {
    if (policyAnswer.refused) {
        return policyAnswer.answer;
    }

    const conclusion = formatReviewConclusion(reviewConclusion);
    const flagText =
        flagAssessmentNarrative === null ? "" : ` ${flagAssessmentNarrative}`;

    return `${conclusion}. ${reimbursabilityReason}${flagText}`;
}

function fallbackFindingBadges(input: {
    reviewConclusion: AssistResponse["reviewConclusion"];
    selectedLineItem:
        NormalizedExpenseReportContext["lineItems"][number] | undefined;
    hasSelectedReceipt: boolean;
    flagAssessment: AssistResponse["flagAssessment"];
    policyEvidenceCount: number;
    modelInvoked: boolean;
}): FindingBadge[] {
    const badges: FindingBadge[] = [
        {
            type: "review_conclusion",
            label: formatReviewConclusion(input.reviewConclusion),
            tone: toneForReviewConclusion(input.reviewConclusion),
        },
        {
            type: "model_status",
            label: input.modelInvoked ? "Model reached" : "Policy-only answer",
            tone: input.modelInvoked ? "success" : "neutral",
        },
    ];

    if (input.flagAssessment !== null) {
        badges.push({
            type: "amount_threshold",
            label: input.flagAssessment.isFlagged
                ? "Over $500"
                : "At or below $500",
            tone: input.flagAssessment.isFlagged ? "warning" : "success",
        });
    }
    if (input.selectedLineItem !== undefined) {
        badges.push({
            type: input.hasSelectedReceipt ? "policy_match" : "missing_receipt",
            label: input.hasSelectedReceipt
                ? "Receipt present"
                : "Missing receipt",
            tone: input.hasSelectedReceipt ? "success" : "warning",
        });
    }
    badges.push({
        type: "policy_context",
        label:
            input.policyEvidenceCount > 0
                ? "Policy evidence found"
                : "Policy evidence limited",
        tone: input.policyEvidenceCount > 0 ? "info" : "warning",
    });

    return badges;
}

function fallbackMissingInformation(
    selectedLineItem:
        NormalizedExpenseReportContext["lineItems"][number] | undefined,
    hasSelectedReceipt: boolean,
    policyEvidenceCount: number,
    policyAnswer: PolicyAnswer,
): string[] {
    const missing: string[] = [];
    if (selectedLineItem === undefined) {
        missing.push("Select a line item for a line-specific assessment.");
    }
    if (selectedLineItem !== undefined && !hasSelectedReceipt) {
        missing.push("Receipt metadata for the selected line item.");
    }
    if (policyEvidenceCount === 0 || policyAnswer.abstained) {
        missing.push("Relevant tenant policy evidence.");
    }

    return missing.slice(0, 5);
}

function formatReviewConclusion(
    conclusion: AssistResponse["reviewConclusion"],
): string {
    switch (conclusion) {
        case "insufficient_context":
            return "Insufficient context";
        case "needs_review":
            return "Needs review";
        case "not_reimbursable":
            return "Not reimbursable";
        case "potentially_reimbursable":
            return "Potentially reimbursable";
    }
}

function toneForReviewConclusion(
    conclusion: AssistResponse["reviewConclusion"],
): FindingBadge["tone"] {
    switch (conclusion) {
        case "insufficient_context":
        case "needs_review":
            return "warning";
        case "not_reimbursable":
            return "danger";
        case "potentially_reimbursable":
            return "success";
    }
}

function firstSentence(value: string): string {
    return value.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? value.trim();
}
