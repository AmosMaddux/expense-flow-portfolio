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

const assistResponseSchema = z.object({
    answer: z.string(),
    answerSummary: z.string().default("No summary was returned."),
    reviewConclusion: z
        .enum([
            "potentially_reimbursable",
            "not_reimbursable",
            "needs_review",
            "insufficient_context",
        ])
        .default("insufficient_context"),
    reimbursabilityAssessment: z
        .object({
            status: z.enum([
                "potentially_reimbursable",
                "not_reimbursable",
                "needs_more_info",
            ]),
            reason: z.string(),
        })
        .default({
            status: "needs_more_info",
            reason: "No reimbursability assessment was returned.",
        }),
    flagAssessmentNarrative: z.string().nullable().default(null),
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
    expenseReportFindings: z
        .array(
            z.object({
                type: z.enum([
                    "policy_match",
                    "missing_receipt",
                    "amount_threshold",
                    "deductibility_review",
                    "insufficient_context",
                ]),
                severity: z.enum(["info", "warning"]),
                summary: z.string(),
                relatedLineItemId: z.uuid().nullable(),
                citations: z.array(z.string()),
            }),
        )
        .default([]),
    findingBadges: z
        .array(
            z.object({
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
                label: z.string(),
                tone: z.enum([
                    "neutral",
                    "info",
                    "success",
                    "warning",
                    "danger",
                ]),
            }),
        )
        .default([]),
    policyEvidence: z
        .array(
            z.object({
                summary: z.string(),
                citation: z.string(),
            }),
        )
        .default([]),
    missingInformation: z.array(z.string()).default([]),
    recommendedNextActions: z.array(z.string()).default([]),
    policyRetrievalStatus: z
        .enum([
            "baseline_and_retrieved",
            "baseline_only",
            "retrieved_only",
            "empty",
        ])
        .default("empty"),
    modelInvoked: z.boolean().default(false),
    baselineContextCount: z.number().int().nonnegative().default(0),
    retrievedContextCount: z.number().int().nonnegative().default(0),
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
                    {isSubmitting ? "Checking policy…" : "Ask Assist"}
                </Button>
            </form>
            {error === null ? null : <p role="alert">{error}</p>}
            {isSubmitting ? (
                <p aria-live="polite" role="status">
                    Checking the policy guidance…
                </p>
            ) : null}
            {answer === null ? null : (
                <article aria-live="polite">
                    {answer.findingBadges.length === 0 ? null : (
                        <div
                            className="assist-panel__badge-row"
                            aria-label="Assist result badges"
                        >
                            {answer.findingBadges.map((badge, index) => (
                                <Badge
                                    key={`${badge.type}-${badge.label}-${String(index)}`}
                                    tone={badge.tone}
                                >
                                    {badge.label}
                                </Badge>
                            ))}
                        </div>
                    )}
                    <section aria-labelledby="assist-summary-heading">
                        <h5 id="assist-summary-heading">Summary</h5>
                        <p>{answer.answerSummary}</p>
                    </section>
                    <p className="assist-panel__diagnostics">
                        {formatPolicyRetrievalStatus(
                            answer.policyRetrievalStatus,
                        )}
                        {" · "}
                        {answer.modelInvoked
                            ? "Model reached"
                            : "Policy-only answer"}
                    </p>
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
                            {": "}
                            {answer.reimbursabilityAssessment.reason}
                        </p>
                    </section>
                    {answer.flagAssessmentNarrative === null ? null : (
                        <section aria-labelledby="assist-flag-heading">
                            <h5 id="assist-flag-heading">Flag review</h5>
                            <p>{answer.flagAssessmentNarrative}</p>
                        </section>
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
                    {answer.expenseReportFindings.length === 0 ? null : (
                        <section aria-labelledby="assist-findings-heading">
                            <h5 id="assist-findings-heading">
                                Expense Report findings
                            </h5>
                            <ul className="assist-panel__findings">
                                {answer.expenseReportFindings.map(
                                    (finding, index) => (
                                        <li
                                            key={`${finding.type}-${String(index)}`}
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
                                        <p>{evidence.summary}</p>
                                        <span>
                                            Citation: {evidence.citation}
                                        </span>
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
                                {answer.recommendedNextActions.map((action) => (
                                    <li key={action}>{action}</li>
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
                                        <strong>{context.section}</strong>
                                        <Badge
                                            tone={
                                                context.source === "baseline"
                                                    ? "info"
                                                    : "neutral"
                                            }
                                        >
                                            {context.source === "baseline"
                                                ? "Baseline"
                                                : "Retrieved"}
                                        </Badge>
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

function formatFindingType(
    type: AssistResponse["expenseReportFindings"][number]["type"],
): string {
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
            return "No policy context found";
        case "retrieved_only":
            return "Retrieved policy context";
    }
}

function formatReimbursabilityStatus(
    status: AssistResponse["reimbursabilityAssessment"]["status"],
): string {
    switch (status) {
        case "needs_more_info":
            return "Needs more information";
        case "not_reimbursable":
            return "Not reimbursable";
        case "potentially_reimbursable":
            return "Potentially reimbursable";
    }
}
