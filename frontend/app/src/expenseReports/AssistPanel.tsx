import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { useSession } from "../auth";
import { Badge, Button } from "../components";
import { QueryRequestError } from "../query/queryClient";

export type AssistPanelLineItem = {
    id: string;
    label: string;
};

export type AssistPanelCaseContext = {
    expenseReportId: string;
    lineItems: AssistPanelLineItem[];
};

const findingTypeSchema = z.enum([
    "policy_match",
    "missing_receipt",
    "amount_threshold",
    "deductibility_review",
    "insufficient_context",
]);
const badgeToneSchema = z.enum([
    "neutral",
    "info",
    "success",
    "warning",
    "danger",
]);

const assistResponseSchema = z.object({
    answer: z.string(),
    answerSummary: z.string(),
    reviewConclusion: z.enum([
        "potentially_reimbursable",
        "not_reimbursable",
        "needs_review",
        "insufficient_context",
    ]),
    reimbursabilityAssessment: z.object({
        status: z.enum([
            "potentially_reimbursable",
            "not_reimbursable",
            "needs_more_info",
        ]),
        reason: z.string(),
    }),
    flagAssessmentNarrative: z.string().nullable(),
    citations: z.array(z.string()),
    contexts: z.array(
        z.object({
            citation: z.string(),
            section: z.string(),
            content: z.string(),
            score: z.number(),
            source: z.enum(["baseline", "retrieved"]),
        }),
    ),
    refused: z.boolean(),
    abstained: z.boolean(),
    refusalCategory: z.string().nullable(),
    caseContext: z.object({
        expenseReportId: z.uuid(),
        lineItemId: z.uuid().nullable(),
    }),
    flagAssessment: z
        .object({
            amount: z.string(),
            threshold: z.literal("500.00"),
            isFlagged: z.boolean(),
            rule: z.literal("line_item_amount_over_500"),
        })
        .nullable(),
    expenseReportFindings: z.array(
        z.object({
            type: findingTypeSchema,
            severity: z.enum(["info", "warning"]),
            summary: z.string(),
            relatedLineItemId: z.uuid().nullable(),
            citations: z.array(z.string()),
        }),
    ),
    findingBadges: z.array(
        z.object({
            type: z.string(),
            label: z.string(),
            tone: badgeToneSchema,
        }),
    ),
    policyEvidence: z.array(
        z.object({
            summary: z.string(),
            citation: z.string(),
        }),
    ),
    missingInformation: z.array(z.string()),
    recommendedNextActions: z.array(z.string()),
    policyRetrievalStatus: z.enum([
        "baseline_and_retrieved",
        "baseline_only",
        "retrieved_only",
        "empty",
    ]),
    modelInvoked: z.boolean(),
    baselineContextCount: z.number(),
    retrievedContextCount: z.number(),
});

type AssistResponse = z.infer<typeof assistResponseSchema>;

/** Renders a cited policy question panel for the active Expense Report. */
export function AssistPanel({
    caseContext,
}: {
    caseContext: AssistPanelCaseContext;
}): JSX.Element {
    const session = useSession();
    const requestSequence = useRef(0);
    const requestController = useRef<AbortController | null>(null);
    const [question, setQuestion] = useState("");
    const [lineItemId, setLineItemId] = useState("");
    const [answer, setAnswer] = useState<AssistResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        requestSequence.current += 1;
        requestController.current?.abort();
        requestController.current = null;
        setAnswer(null);
        setError(null);
        setLineItemId("");
        setIsSubmitting(false);
    }, [caseContext.expenseReportId]);

    useEffect(
        () => () => {
            requestController.current?.abort();
        },
        [],
    );

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsedQuestion = question.trim();
        if (parsedQuestion.length === 0) {
            setError("Enter a policy question.");
            return;
        }

        requestController.current?.abort();
        const controller = new AbortController();
        requestController.current = controller;
        const requestId = requestSequence.current + 1;
        requestSequence.current = requestId;
        const submittedContext = {
            expenseReportId: caseContext.expenseReportId,
            lineItemId: lineItemId.length === 0 ? null : lineItemId,
        };

        setIsSubmitting(true);
        setError(null);
        try {
            const response = await session.authenticatedFetch("/v1/assist", {
                body: JSON.stringify({
                    question: parsedQuestion,
                    caseContext: {
                        expenseReportId: submittedContext.expenseReportId,
                        ...(submittedContext.lineItemId === null
                            ? {}
                            : { lineItemId: submittedContext.lineItemId }),
                    },
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new QueryRequestError(
                    response.status,
                    "Unable to answer the policy question.",
                );
            }

            const parsedResponse = assistResponseSchema.parse(
                await response.json(),
            );
            if (
                parsedResponse.caseContext.expenseReportId !==
                    submittedContext.expenseReportId ||
                parsedResponse.caseContext.lineItemId !==
                    submittedContext.lineItemId
            ) {
                throw new Error(
                    "Assist returned a response for a different Expense Report.",
                );
            }
            if (requestSequence.current === requestId) {
                setAnswer(parsedResponse);
            }
        } catch (requestError: unknown) {
            if (
                controller.signal.aborted ||
                requestSequence.current !== requestId
            ) {
                return;
            }
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Unable to answer the policy question.",
            );
        } finally {
            if (requestSequence.current === requestId) {
                setIsSubmitting(false);
                requestController.current = null;
            }
        }
    };

    const citedContexts =
        answer === null
            ? []
            : answer.contexts.filter((context) =>
                  answer.citations.includes(context.citation),
              );

    return (
        <section className="assist-panel" aria-labelledby="assist-heading">
            <h4 id="assist-heading">AI Assist</h4>
            <p>
                Answers are grounded in this organization&apos;s expense policy.
            </p>
            <form
                onSubmit={(event) => {
                    void submit(event);
                }}
            >
                <label>
                    Line item context (optional)
                    <select
                        value={lineItemId}
                        onChange={(event) => setLineItemId(event.target.value)}
                    >
                        <option value="">Entire Expense Report</option>
                        {caseContext.lineItems.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Ask about reimbursability or flags
                    <textarea
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        rows={3}
                    />
                </label>
                <Button
                    disabled={isSubmitting}
                    type="submit"
                    variant="secondary"
                >
                    {isSubmitting ? "Checking policy..." : "Ask Assist"}
                </Button>
            </form>
            {error === null ? null : <p role="alert">{error}</p>}
            {isSubmitting ? (
                <p aria-live="polite" role="status">
                    Checking the policy guidance...
                </p>
            ) : null}
            {answer === null ? null : (
                <article aria-live="polite">
                    <div className="assist-panel__badge-row">
                        {answer.findingBadges.map((badge) => (
                            <Badge
                                key={`${badge.type}-${badge.label}`}
                                tone={badge.tone}
                            >
                                {badge.label}
                            </Badge>
                        ))}
                    </div>
                    <p className="assist-panel__diagnostics">
                        {formatPolicyRetrievalStatus(
                            answer.policyRetrievalStatus,
                        )}{" "}
                        |{" "}
                        {answer.modelInvoked
                            ? "Model response used"
                            : "Policy-only fallback"}
                    </p>
                    <section aria-labelledby="assist-summary-heading">
                        <h5 id="assist-summary-heading">Summary</h5>
                        <p>{answer.answerSummary}</p>
                    </section>
                    <section aria-labelledby="assist-answer-heading">
                        <h5 id="assist-answer-heading">Answer</h5>
                        <p>{answer.answer}</p>
                    </section>
                    <section aria-labelledby="assist-reimbursability-heading">
                        <h5 id="assist-reimbursability-heading">
                            Reimbursability
                        </h5>
                        <p>
                            <strong>
                                {formatReimbursabilityStatus(
                                    answer.reimbursabilityAssessment.status,
                                )}
                            </strong>
                            : {answer.reimbursabilityAssessment.reason}
                        </p>
                    </section>
                    {answer.flagAssessmentNarrative === null &&
                    answer.flagAssessment === null ? null : (
                        <section aria-labelledby="assist-flags-heading">
                            <h5 id="assist-flags-heading">Flag review</h5>
                            {answer.flagAssessmentNarrative === null ? null : (
                                <p>{answer.flagAssessmentNarrative}</p>
                            )}
                            {answer.flagAssessment === null ? null : (
                                <p>
                                    Deterministic flag rule:{" "}
                                    {answer.flagAssessment.amount} is{" "}
                                    {answer.flagAssessment.isFlagged
                                        ? "over"
                                        : "not over"}{" "}
                                    $500.00, so this line item is{" "}
                                    {answer.flagAssessment.isFlagged
                                        ? "flagged"
                                        : "not flagged"}
                                    .
                                </p>
                            )}
                        </section>
                    )}
                    {answer.expenseReportFindings.length === 0 ? null : (
                        <section aria-labelledby="assist-findings-heading">
                            <h5 id="assist-findings-heading">Findings</h5>
                            <ul className="assist-panel__findings">
                                {answer.expenseReportFindings.map(
                                    (finding, index) => (
                                        <li
                                            key={`${finding.type}-${finding.relatedLineItemId ?? "report"}-${String(index)}`}
                                        >
                                            <Badge
                                                tone={
                                                    finding.severity ===
                                                    "warning"
                                                        ? "warning"
                                                        : "info"
                                                }
                                            >
                                                {formatFindingType(
                                                    finding.type,
                                                )}
                                            </Badge>
                                            <p>{finding.summary}</p>
                                        </li>
                                    ),
                                )}
                            </ul>
                        </section>
                    )}
                    {answer.policyEvidence.length === 0 ? null : (
                        <section aria-labelledby="assist-evidence-heading">
                            <h5 id="assist-evidence-heading">
                                Policy evidence
                            </h5>
                            <ul className="assist-panel__evidence">
                                {answer.policyEvidence.map((evidence) => (
                                    <li key={evidence.citation}>
                                        <strong>{evidence.citation}</strong>
                                        <p>{evidence.summary}</p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {answer.missingInformation.length === 0 ? null : (
                        <section aria-labelledby="assist-missing-heading">
                            <h5 id="assist-missing-heading">
                                Missing information
                            </h5>
                            <ul className="assist-panel__missing">
                                {answer.missingInformation.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {answer.recommendedNextActions.length === 0 ? null : (
                        <section aria-labelledby="assist-actions-heading">
                            <h5 id="assist-actions-heading">Next actions</h5>
                            <ul className="assist-panel__actions">
                                {answer.recommendedNextActions.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {citedContexts.length === 0 ? null : (
                        <section aria-labelledby="assist-sources-heading">
                            <h5 id="assist-sources-heading">Policy sources</h5>
                            <ul className="assist-panel__sources">
                                {citedContexts.map((context) => (
                                    <li
                                        key={`${context.citation}-${context.section}`}
                                    >
                                        <div className="assist-panel__source-heading">
                                            <strong>{context.section}</strong>
                                            <Badge tone="neutral">
                                                {context.source === "baseline"
                                                    ? "Baseline"
                                                    : "Retrieved"}
                                            </Badge>
                                        </div>
                                        <p>{context.content}</p>
                                        <span>
                                            Citation: {context.citation}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </article>
            )}
        </section>
    );
}

function formatFindingType(type: z.infer<typeof findingTypeSchema>): string {
    switch (type) {
        case "amount_threshold":
            return "Amount threshold";
        case "deductibility_review":
            return "Deductibility review";
        case "insufficient_context":
            return "Insufficient context";
        case "missing_receipt":
            return "Missing receipt";
        case "policy_match":
            return "Policy match";
    }
}

function formatPolicyRetrievalStatus(
    status: AssistResponse["policyRetrievalStatus"],
): string {
    switch (status) {
        case "baseline_and_retrieved":
            return "Baseline and retrieved policy context";
        case "baseline_only":
            return "Baseline policy context";
        case "empty":
            return "No policy context";
        case "retrieved_only":
            return "Retrieved policy context";
    }
}

function formatReimbursabilityStatus(
    status: AssistResponse["reimbursabilityAssessment"]["status"],
): string {
    switch (status) {
        case "needs_more_info":
            return "Needs more info";
        case "not_reimbursable":
            return "Not reimbursable";
        case "potentially_reimbursable":
            return "Potentially reimbursable";
    }
}
