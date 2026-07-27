import { useState } from "react";
import { z } from "zod";

import {
    Button,
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

const mySubmissionDetailSchema = z
    .object({
        id: z.uuid(),
        currentStage: z.enum(EXPENSE_REPORT_STAGES),
        lineItems: z.array(
            z
                .object({
                    id: z.uuid(),
                    merchant: z.string(),
                    expenseDate: z.iso.date(),
                    category: z.string(),
                    amount: z.number().nonnegative(),
                    currency: z.string(),
                })
                .strict(),
        ),
        mileageEntries: z.array(
            z
                .object({
                    id: z.uuid(),
                    route: z.string(),
                    distance: z.number().positive(),
                    mileageDate: z.iso.date(),
                    reimbursementAmount: z.number().nonnegative(),
                    currency: z.literal("USD"),
                })
                .strict(),
        ),
    })
    .strict();

type MySubmissionDetail = z.infer<typeof mySubmissionDetailSchema>;

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
    const [showDetails, setShowDetails] = useState(false);

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
                <div className="my-submission__actions">
                    <div className="my-submission__badges">
                        <StatusBadge
                            label={submission.currentStage}
                            tone={getStageTone(submission.currentStage)}
                        />
                        {submission.isOverdue ? (
                            <OverdueBadge isOverdue />
                        ) : null}
                    </div>
                    <Button
                        aria-expanded={showDetails}
                        onClick={() => setShowDetails((current) => !current)}
                        size="sm"
                        variant="secondary"
                    >
                        {showDetails ? "Hide details" : "View details"}
                    </Button>
                </div>
            </header>
            <StageStepper
                currentStage={submission.currentStage}
                onHold={submission.onHold}
            />
            {showDetails ? (
                <SubmissionDetails submissionId={submission.id} />
            ) : null}
        </article>
    );
}

function SubmissionDetails({
    submissionId,
}: {
    submissionId: string;
}): JSX.Element {
    const query = useExpenseFlowQuery<MySubmissionDetail>({
        input: `/v1/expense-reports/${submissionId}/submission-detail`,
        keyParts: ["my-submissions", submissionId, "detail"],
        parseResponse: async (response) =>
            mySubmissionDetailSchema.parse(await response.json()),
        staleTime: 30_000,
    });

    if (query.isPending) {
        return <LoadingSkeleton label="Loading submission details" rows={2} />;
    }

    if (query.isError) {
        return (
            <ErrorState
                isRetrying={query.isFetching}
                message="The report details could not be loaded. Please try again."
                onRetry={() => {
                    void query.refetch();
                }}
                title="Unable to load report details"
            />
        );
    }

    if (
        query.data.lineItems.length === 0 &&
        query.data.mileageEntries.length === 0
    ) {
        return (
            <div className="my-submission-detail my-submission-detail--empty">
                No line items or mileage entries have been added to this report.
            </div>
        );
    }

    return (
        <section
            className="my-submission-detail"
            aria-label="Submission details"
        >
            {query.data.lineItems.length > 0 ? (
                <LineItemTable lineItems={query.data.lineItems} />
            ) : null}
            {query.data.mileageEntries.length > 0 ? (
                <MileageTable mileageEntries={query.data.mileageEntries} />
            ) : null}
        </section>
    );
}

function LineItemTable({
    lineItems,
}: {
    lineItems: MySubmissionDetail["lineItems"];
}): JSX.Element {
    return (
        <div className="my-submission-detail__section">
            <h4>Line items</h4>
            <div className="my-submission-detail__table-frame">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Merchant</th>
                            <th scope="col">Category</th>
                            <th scope="col">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lineItems.map((item) => (
                            <tr key={item.id}>
                                <td>{formatDate(item.expenseDate)}</td>
                                <td>{item.merchant}</td>
                                <td>{item.category}</td>
                                <td>
                                    {formatCurrency(item.amount, item.currency)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function MileageTable({
    mileageEntries,
}: {
    mileageEntries: MySubmissionDetail["mileageEntries"];
}): JSX.Element {
    return (
        <div className="my-submission-detail__section">
            <h4>Mileage</h4>
            <div className="my-submission-detail__table-frame">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Route</th>
                            <th scope="col">Distance</th>
                            <th scope="col">Reimbursement</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mileageEntries.map((entry) => (
                            <tr key={entry.id}>
                                <td>{formatDate(entry.mileageDate)}</td>
                                <td>{entry.route}</td>
                                <td>{entry.distance.toFixed(2)} mi</td>
                                <td>
                                    {formatCurrency(
                                        entry.reimbursementAmount,
                                        entry.currency,
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
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

function formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
    }).format(amount);
}

function getMySubmissionsErrorMessage(error: Error): string {
    if (error instanceof QueryRequestError && error.status === 403) {
        return "My Submissions is available only in the Employee Portal.";
    }

    return "Your submissions could not be loaded. Please try again.";
}
