import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { useSession } from "../auth";
import { Button } from "../components";
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
    citations: z.array(z.string()),
    contexts: z.array(
        z.object({
            citation: z.string(),
            section: z.string(),
            content: z.string(),
            score: z.number(),
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
                    <p>{answer.answer}</p>
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
                    {citedContexts.length === 0 ? null : (
                        <section aria-labelledby="assist-sources-heading">
                            <h5 id="assist-sources-heading">Policy sources</h5>
                            <ul className="assist-panel__sources">
                                {citedContexts.map((context) => (
                                    <li
                                        key={`${context.citation}-${context.section}`}
                                    >
                                        <strong>{context.section}</strong>
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
