import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useSession } from "../auth";
import { EmptyState, ErrorState } from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";
import {
    expenseReportSchema,
    mileageConfigSchema,
    mileageEntrySchema,
    mileageFormSchema,
    type MileageEntry,
    type MileageFormInput,
    type MileageFormValues,
} from "./mileageSchemas";

type DraftExpenseReport = {
    id: string;
    currentStage: "Drafted";
};

/**
 * Renders the employee Mileage Tracker form and reimbursement preview.
 */
export function LogMileageScreen(): JSX.Element {
    const session = useSession();
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const draftQuery = useExpenseFlowQuery<DraftExpenseReport>({
        input: "/v1/expense-reports/drafts/current",
        keyParts: ["expense-reports", "drafts", "current"],
        parseResponse: async (response) =>
            expenseReportSchema.parse(await response.json()),
    });
    const configQuery = useExpenseFlowQuery({
        input: "/v1/expense-reports/config/mileage",
        keyParts: ["expense-reports", "config", "mileage"],
        parseResponse: async (response) =>
            mileageConfigSchema.parse(await response.json()),
        staleTime: 5 * 60_000,
    });
    const form = useForm<MileageFormInput, unknown, MileageFormValues>({
        resolver: zodResolver(mileageFormSchema),
        defaultValues: {
            mileageDate: "",
            routeFrom: "",
            routeTo: "",
            distance: undefined,
        },
        mode: "onBlur",
    });
    const distance = Number(form.watch("distance"));
    const previewAmount =
        Number.isFinite(distance) && distance > 0 && configQuery.data
            ? distance * configQuery.data.ratePerMile
            : 0;
    const mutation = useMutation({
        mutationFn: async (values: MileageFormValues) => {
            if (draftQuery.data === undefined) {
                throw new MileageRequestError(
                    "No Drafted Expense Report is available.",
                );
            }

            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${draftQuery.data.id}/mileage-entries`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        route: `${values.routeFrom} → ${values.routeTo}`,
                        distance: values.distance,
                        mileageDate: values.mileageDate,
                    }),
                },
            );

            if (!response.ok) {
                throw await createMileageRequestError(response);
            }

            return mileageEntrySchema.parse(await response.json());
        },
        onSuccess: (entry: MileageEntry) => {
            setSuccessMessage(
                `${formatCurrency(entry.reimbursement.amount)} was added to your draft.`,
            );
            form.reset();
        },
    });

    if (draftQuery.isPending || configQuery.isPending) {
        return (
            <section
                aria-label="Loading Mileage Tracker"
                aria-live="polite"
                className="mileage-loading"
                role="status"
            >
                <p>Checking for a Drafted Expense Report...</p>
            </section>
        );
    }

    const loadError = draftQuery.error ?? configQuery.error;
    if (loadError !== null) {
        const hasNoDraft =
            loadError instanceof QueryRequestError && loadError.status === 404;

        if (hasNoDraft) {
            return (
                <EmptyState
                    action={
                        <Link
                            className="button button--primary mileage-empty__action"
                            to="/submit-expense"
                        >
                            Create a draft report
                        </Link>
                    }
                    body="Create a Drafted Expense Report before logging mileage."
                    icon={null}
                    title="No draft report available"
                />
            );
        }

        return (
            <ErrorState
                message={getErrorMessage(loadError)}
                onRetry={() => {
                    void Promise.allSettled([
                        draftQuery.refetch(),
                        configQuery.refetch(),
                    ]);
                }}
                title="Unable to load Mileage Tracker"
            />
        );
    }

    if (draftQuery.data === undefined || configQuery.data === undefined) {
        return (
            <ErrorState
                message="Mileage Tracker data was unavailable."
                onRetry={() => {
                    void Promise.allSettled([
                        draftQuery.refetch(),
                        configQuery.refetch(),
                    ]);
                }}
            />
        );
    }

    return (
        <section className="mileage-screen" aria-labelledby="mileage-heading">
            <header className="mileage-screen__header">
                <p className="screen-placeholder__label">Mileage Tracker</p>
                <h2 id="mileage-heading">New Mileage Log</h2>
                <p>
                    Enter your business trip details to add mileage to your
                    Drafted Expense Report.
                </p>
            </header>

            <div className="mileage-layout">
                <form
                    className="mileage-form"
                    noValidate
                    onSubmit={(event) => {
                        setSuccessMessage(null);
                        void form.handleSubmit((values) => {
                            mutation.mutate(values);
                        })(event);
                    }}
                >
                    <MileageField
                        error={form.formState.errors.mileageDate?.message}
                        id="mileageDate"
                        label="Trip Date"
                    >
                        <input
                            aria-describedby={
                                form.formState.errors.mileageDate === undefined
                                    ? undefined
                                    : "mileageDate-error"
                            }
                            aria-invalid={
                                form.formState.errors.mileageDate !== undefined
                            }
                            id="mileageDate"
                            max={getCurrentLocalDate()}
                            type="date"
                            {...form.register("mileageDate")}
                        />
                    </MileageField>

                    <div className="mileage-form__route">
                        <MileageField
                            error={form.formState.errors.routeFrom?.message}
                            id="routeFrom"
                            label="Route (From)"
                        >
                            <input
                                aria-describedby={
                                    form.formState.errors.routeFrom ===
                                    undefined
                                        ? undefined
                                        : "routeFrom-error"
                                }
                                aria-invalid={
                                    form.formState.errors.routeFrom !==
                                    undefined
                                }
                                id="routeFrom"
                                placeholder="Office / Starting point"
                                type="text"
                                {...form.register("routeFrom")}
                            />
                        </MileageField>
                        <MileageField
                            error={form.formState.errors.routeTo?.message}
                            id="routeTo"
                            label="Route (To)"
                        >
                            <input
                                aria-describedby={
                                    form.formState.errors.routeTo === undefined
                                        ? undefined
                                        : "routeTo-error"
                                }
                                aria-invalid={
                                    form.formState.errors.routeTo !== undefined
                                }
                                id="routeTo"
                                placeholder="Client site / Destination"
                                type="text"
                                {...form.register("routeTo")}
                            />
                        </MileageField>
                    </div>

                    <div className="mileage-form__calculation">
                        <MileageField
                            error={form.formState.errors.distance?.message}
                            id="distance"
                            label="Distance (miles)"
                        >
                            <div className="mileage-distance">
                                <input
                                    aria-describedby={
                                        form.formState.errors.distance ===
                                        undefined
                                            ? undefined
                                            : "distance-error"
                                    }
                                    aria-invalid={
                                        form.formState.errors.distance !==
                                        undefined
                                    }
                                    id="distance"
                                    inputMode="decimal"
                                    min="0"
                                    placeholder="0.00"
                                    step="0.01"
                                    type="number"
                                    {...form.register("distance", {
                                        valueAsNumber: true,
                                    })}
                                />
                                <span aria-hidden="true">mi</span>
                            </div>
                        </MileageField>

                        <output
                            aria-live="polite"
                            className="mileage-preview"
                            htmlFor="distance"
                        >
                            <span>Reimbursement</span>
                            <strong>{formatCurrency(previewAmount)}</strong>
                        </output>
                    </div>

                    {mutation.isError ? (
                        <p
                            className="form-message form-message--error"
                            role="alert"
                        >
                            {getErrorMessage(mutation.error)}
                        </p>
                    ) : null}
                    {successMessage === null ? null : (
                        <p
                            className="form-message form-message--success"
                            role="status"
                        >
                            {successMessage}
                        </p>
                    )}

                    <div className="mileage-form__actions">
                        <button
                            className="button button--secondary"
                            disabled={mutation.isPending}
                            onClick={() => {
                                form.reset();
                                setSuccessMessage(null);
                            }}
                            type="button"
                        >
                            Clear
                        </button>
                        <button
                            className="button button--primary"
                            disabled={mutation.isPending}
                            type="submit"
                        >
                            {mutation.isPending
                                ? "Adding mileage..."
                                : "Add to Draft"}
                        </button>
                    </div>
                </form>

                <aside className="mileage-policy" aria-label="Mileage policy">
                    <h3>Policy guide</h3>
                    <p>Configured reimbursement rate</p>
                    <strong>
                        {formatCurrency(configQuery.data.ratePerMile)} / mile
                    </strong>
                    <p>
                        Commuting distance is not reimbursable. Enter only
                        business travel associated with this report.
                    </p>
                </aside>
            </div>
        </section>
    );
}

function MileageField({
    children,
    error,
    id,
    label,
}: {
    children: React.ReactNode;
    error?: string;
    id: string;
    label: string;
}): JSX.Element {
    const errorId = `${id}-error`;

    return (
        <div className="mileage-field">
            <label htmlFor={id}>{label}</label>
            {children}
            {error === undefined ? null : (
                <p className="mileage-field__error" id={errorId} role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

/** Represents a rejected Mileage Tracker API mutation. */
class MileageRequestError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "MileageRequestError";
    }
}

async function createMileageRequestError(
    response: Response,
): Promise<MileageRequestError> {
    const responseBody: unknown = await response.json().catch(() => undefined);
    if (
        responseBody !== null &&
        typeof responseBody === "object" &&
        "detail" in responseBody &&
        typeof responseBody.detail === "string"
    ) {
        return new MileageRequestError(responseBody.detail);
    }

    return new MileageRequestError("Unable to add mileage to the draft.");
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : "Unable to complete the mileage request.";
}

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(amount);
}

function getCurrentLocalDate(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}
