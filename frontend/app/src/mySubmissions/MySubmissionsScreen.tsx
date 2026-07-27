import { z } from "zod";

import {
    EmptyState,
    ErrorState,
    EXPENSE_REPORT_STAGES,
    LoadingSkeleton,
    OverdueBadge,
    StageStepper,
    StatusBadge,
} from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";

const mySubmissionSchema = z
    .object({
        id: z.uuid(),
        dueDate: z.iso.date(),
        currentStage: z.enum(EXPENSE_REPORT_STAGES),
        onHold: z.boolean(),
        isOverdue: z.boolean(),
        createdAt: z.iso.datetime({ offset: true }),
        updatedAt: z.iso.datetime({ offset: true }),
    })
    .strict();

export const mySubmissionListSchema = z.array(mySubmissionSchema);

export type MySubmission = z.infer<typeof mySubmissionSchema>;

/**
 * Fetches Expense Reports scoped by the BFF to the authenticated employee.
 */
export function useMySubmissions() {
    return useExpenseFlowQuery<MySubmission[]>({
        input: "/v1/expense-reports/my-submissions",
        keyParts: ["my-submissions"],
        parseResponse: async (response) =>
            mySubmissionListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Renders the employee's submission history and workflow position.
 */
export function MySubmissionsScreen(): JSX.Element {
    const query = useMySubmissions();

    return (
        <section
            className="my-submissions"
            aria-labelledby="my-submissions-heading"
        >
            <header className="my-submissions__header">
                <div>
                    <p className="screen-placeholder__label">Employee Portal</p>
                    <h2 id="my-submissions-heading">My Submissions</h2>
                    <p>
                        Track each Expense Report from draft through
                        reconciliation.
                    </p>
                </div>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading My Submissions" rows={4} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getMySubmissionsErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load My Submissions"
                />
            ) : query.data.length === 0 ? (
                <EmptyState
                    body="Submitted Expense Reports and saved drafts will appear here."
                    title="No submissions yet"
                />
            ) : (
                <div
                    className="my-submissions__list"
                    aria-label="My Expense Reports"
                >
                    {query.data.map((submission) => (
                        <SubmissionRow
                            key={submission.id}
                            submission={submission}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function SubmissionRow({
    submission,
}: {
    submission: MySubmission;
}): JSX.Element {
    return (
        <article
            className="my-submission"
            aria-label={`Expense Report ${submission.id}`}
        >
            <header className="my-submission__summary">
                <div>
                    <h3>Expense Report {submission.id.slice(0, 8)}</h3>
                    <p>
                        Due{" "}
                        <time dateTime={submission.dueDate}>
                            {formatDate(submission.dueDate)}
                        </time>
                    </p>
                </div>
                <div className="my-submission__badges">
                    <StatusBadge
                        label={submission.currentStage}
                        tone={getStageTone(submission.currentStage)}
                    />
                    {submission.isOverdue ? <OverdueBadge isOverdue /> : null}
                </div>
            </header>
            <StageStepper
                currentStage={submission.currentStage}
                onHold={submission.onHold}
            />
        </article>
    );
}

function formatDate(value: string): string {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) {
        return value;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

function getStageTone(
    stage: MySubmission["currentStage"],
): "info" | "neutral" | "success" | "warning" {
    if (stage === "Reconciled") {
        return "success";
    }
    if (stage === "Drafted") {
        return "neutral";
    }
    if (stage === "Paid") {
        return "info";
    }

    return "warning";
}

function getMySubmissionsErrorMessage(error: Error): string {
    if (error instanceof QueryRequestError && error.status === 403) {
        return "My Submissions is available only in the Employee Portal.";
    }

    return "Your submissions could not be loaded. Please try again.";
}
