import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ZodIssue } from "zod";

import { useSession } from "../auth";
import {
    createTenantQueryKey,
    QueryRequestError,
    useExpenseFlowQuery,
} from "../query/queryClient";
import {
    assembledDraftSchema,
    draftExpenseContentSchema,
    draftExpenseReportSchema,
    expenseCategories,
    receiptUploadResponseSchema,
    submittedExpenseReportSchema,
    submitExpenseFormSchema,
    type DraftExpenseContent,
    type SubmitExpenseFormValues,
} from "./submitExpenseSchemas";

type EditableLineItem = {
    merchant: string;
    expenseDate: string;
    category: "" | (typeof expenseCategories)[number];
    amount: string;
    receipt: File | null;
};

type DraftAction = "save" | "mileage" | "submit";

type DraftMutationResult = {
    action: DraftAction;
    addedContent: ReturnType<typeof assembledDraftSchema.parse> | null;
    reportId: string;
    submitted: boolean;
    values: SubmitExpenseFormValues;
};

const emptyLineItem = (): EditableLineItem => ({
    merchant: "",
    expenseDate: "",
    category: "",
    amount: "",
    receipt: null,
});

const emptyDraftContent = (expenseReportId = ""): DraftExpenseContent => ({
    expenseReportId,
    lineItems: [],
    receipts: [],
    mileageEntries: [],
});

/**
 * Renders the Employee workflow for drafting expenses, adding mileage, and submitting.
 */
export function SubmitExpenseScreen(): JSX.Element {
    const session = useSession();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [lineItems, setLineItems] = useState<EditableLineItem[]>([
        emptyLineItem(),
    ]);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [submittedReportId, setSubmittedReportId] = useState<string | null>(
        null,
    );
    const [draftIdOverride, setDraftIdOverride] = useState<string | null>(null);
    const [savedContentOverride, setSavedContentOverride] =
        useState<DraftExpenseContent | null>(null);
    const initializedExistingDraft = useRef(false);
    const requestKeys = useRef({
        create: crypto.randomUUID(),
        content: crypto.randomUUID(),
        submit: crypto.randomUUID(),
    });
    const receiptUploadIds = useRef(new WeakMap<File, string>());
    const draftQuery = useExpenseFlowQuery({
        input: "/v1/expense-reports/drafts/current",
        keyParts: ["expense-reports", "drafts", "current"],
        parseResponse: async (response) =>
            draftExpenseReportSchema.parse(await response.json()),
    });
    const activeDraftId = draftIdOverride ?? draftQuery.data?.id;
    const contentQuery = useExpenseFlowQuery({
        input:
            activeDraftId === undefined
                ? "/v1/expense-reports/00000000-0000-4000-8000-000000000000/draft-content"
                : `/v1/expense-reports/${activeDraftId}/draft-content`,
        keyParts: ["expense-reports", activeDraftId, "draft-content"],
        enabled: activeDraftId !== undefined,
        parseResponse: async (response) =>
            draftExpenseContentSchema.parse(await response.json()),
    });
    const savedContent =
        savedContentOverride ??
        contentQuery.data ??
        emptyDraftContent(activeDraftId);

    useEffect(() => {
        if (
            initializedExistingDraft.current ||
            contentQuery.data === undefined
        ) {
            return;
        }

        initializedExistingDraft.current = true;
        if (
            contentQuery.data.lineItems.length > 0 ||
            contentQuery.data.mileageEntries.length > 0
        ) {
            setLineItems([]);
        }
    }, [contentQuery.data]);

    const mutation = useMutation({
        mutationFn: async ({
            action,
            values,
        }: {
            action: DraftAction;
            values: SubmitExpenseFormValues;
        }): Promise<DraftMutationResult> => {
            const user = session.user;
            if (user === null) {
                throw new SubmitExpenseRequestError(
                    "An Employee session is required.",
                );
            }

            const reportId =
                activeDraftId ??
                (await createDraftReport(user.id, requestKeys.current.create));
            const addedContent =
                values.lineItems.length === 0
                    ? null
                    : await addDraftContent(
                          reportId,
                          values,
                          requestKeys.current.content,
                      );

            if (action !== "submit") {
                return {
                    action,
                    addedContent,
                    reportId,
                    submitted: false,
                    values,
                };
            }

            const response = await session.authenticatedFetch(
                `/v1/expense-reports/${reportId}/submit`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": requestKeys.current.submit,
                    },
                    body: JSON.stringify({}),
                },
            );
            if (!response.ok) {
                throw await createSubmitExpenseRequestError(response);
            }

            submittedExpenseReportSchema.parse(await response.json());

            return {
                action,
                addedContent,
                reportId,
                submitted: true,
                values,
            };
        },
        onSuccess: (result) => {
            if (result.submitted) {
                if (session.user !== null) {
                    queryClient.removeQueries({
                        exact: true,
                        queryKey: createTenantQueryKey(session.user, [
                            "expense-reports",
                            "drafts",
                            "current",
                        ]),
                    });
                    queryClient.removeQueries({
                        exact: true,
                        queryKey: createTenantQueryKey(session.user, [
                            "expense-reports",
                            result.reportId,
                            "draft-content",
                        ]),
                    });
                }
                setDraftIdOverride(null);
                setSavedContentOverride(null);
                setLineItems([emptyLineItem()]);
                initializedExistingDraft.current = false;
                requestKeys.current = {
                    create: crypto.randomUUID(),
                    content: crypto.randomUUID(),
                    submit: crypto.randomUUID(),
                };
                setSubmittedReportId(result.reportId);
                return;
            }

            setDraftIdOverride(result.reportId);
            setSavedContentOverride((current) =>
                mergeSavedDraftContent(
                    current ??
                        contentQuery.data ??
                        emptyDraftContent(result.reportId),
                    result,
                ),
            );
            setLineItems([]);
            requestKeys.current.content = crypto.randomUUID();
            setSuccessMessage(
                result.action === "mileage"
                    ? "Draft saved. Opening Mileage Tracker..."
                    : "Draft saved.",
            );

            if (result.action === "mileage") {
                void Promise.resolve(navigate({ to: "/log-mileage" })).catch(
                    () => {
                        setSuccessMessage(null);
                        setErrors({
                            _form: "Draft saved, but Mileage Tracker could not be opened.",
                        });
                    },
                );
            }
        },
    });

    async function createDraftReport(
        owner: string,
        idempotencyKey: string,
    ): Promise<string> {
        const response = await session.authenticatedFetch(
            "/v1/expense-reports",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify({
                    owner,
                    dueDate: getDueDate(),
                    priority: "Normal",
                }),
            },
        );
        if (!response.ok) {
            throw await createSubmitExpenseRequestError(response);
        }

        return draftExpenseReportSchema.parse(await response.json()).id;
    }

    async function addDraftContent(
        reportId: string,
        content: SubmitExpenseFormValues,
        idempotencyKey: string,
    ): Promise<ReturnType<typeof assembledDraftSchema.parse>> {
        const receiptFiles = content.lineItems.flatMap((item, index) =>
            item.receipt === null
                ? []
                : [
                      {
                          lineItemIndex: index,
                          file: item.receipt,
                          uploadId: getReceiptUploadId(item.receipt),
                      },
                  ],
        );
        await Promise.all(
            receiptFiles.map(({ file, uploadId }) =>
                uploadReceipt(reportId, uploadId, file),
            ),
        );
        const receipts = receiptFiles.map(
            ({ file, lineItemIndex, uploadId }) => ({
                lineItemIndex,
                uploadId,
                filename: file.name,
                contentType: file.type,
                sizeBytes: file.size,
            }),
        );
        const response = await session.authenticatedFetch(
            `/v1/expense-reports/${reportId}/draft-content`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotencyKey,
                },
                body: JSON.stringify({
                    lineItems: content.lineItems.map((item) => ({
                        merchant: item.merchant,
                        expenseDate: item.expenseDate,
                        category: item.category,
                        amount: item.amount,
                        currency: "USD",
                    })),
                    receipts,
                }),
            },
        );
        if (!response.ok) {
            throw await createSubmitExpenseRequestError(response);
        }

        return assembledDraftSchema.parse(await response.json());
    }

    function getReceiptUploadId(file: File): string {
        const existing = receiptUploadIds.current.get(file);
        if (existing !== undefined) {
            return existing;
        }

        const uploadId = crypto.randomUUID();
        receiptUploadIds.current.set(file, uploadId);
        return uploadId;
    }

    async function uploadReceipt(
        reportId: string,
        uploadId: string,
        file: File,
    ): Promise<void> {
        const response = await session.authenticatedFetch(
            `/v1/expense-reports/${reportId}/receipt-uploads/${uploadId}?filename=${encodeURIComponent(file.name)}`,
            {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
            },
        );
        if (!response.ok) {
            throw await createSubmitExpenseRequestError(response);
        }

        receiptUploadResponseSchema.parse(await response.json());
    }

    const runAction = (action: DraftAction): void => {
        setErrors({});
        setSuccessMessage(null);
        const savedSourceCount =
            savedContent.lineItems.length + savedContent.mileageEntries.length;
        const enteredLineItems = lineItems.filter(hasLineItemInput);
        const pendingLineItems =
            action === "submit" &&
            enteredLineItems.length === 0 &&
            savedSourceCount === 0
                ? lineItems
                : enteredLineItems;
        const result = submitExpenseFormSchema.safeParse({
            lineItems: pendingLineItems,
        });
        if (!result.success) {
            setErrors(toFieldErrors(result.error.issues));
            return;
        }

        if (
            action === "submit" &&
            savedSourceCount + result.data.lineItems.length === 0
        ) {
            setErrors({
                _form: "Add an expense line item or mileage entry before submitting.",
            });
            return;
        }

        mutation.mutate({ action, values: result.data });
    };

    if (submittedReportId !== null) {
        return (
            <section className="submit-expense-success" role="status">
                <p className="screen-placeholder__label">Expense Report</p>
                <h2>Expense submitted</h2>
                <p>
                    Your Expense Report is now in the Submitted stage and ready
                    for review.
                </p>
            </section>
        );
    }

    const hasNoCurrentDraft =
        draftQuery.error instanceof QueryRequestError &&
        draftQuery.error.status === 404;
    const draftLoadFailed = draftQuery.error !== null && !hasNoCurrentDraft;
    const contentLoadFailed = contentQuery.error !== null;
    const isLoading =
        draftQuery.isPending ||
        (activeDraftId !== undefined && contentQuery.isPending);

    if (isLoading) {
        return (
            <section
                aria-label="Loading Submit Expense"
                aria-live="polite"
                role="status"
            >
                <p>Loading your Drafted Expense Report...</p>
            </section>
        );
    }

    const pendingTotal = lineItems.reduce(
        (total, item) => total + (Number(item.amount) || 0),
        0,
    );
    const expenseTotal =
        pendingTotal +
        savedContent.lineItems.reduce((total, item) => total + item.amount, 0);
    const mileageReimbursementTotal = savedContent.mileageEntries.reduce(
        (total, entry) => total + entry.reimbursementAmount,
        0,
    );
    const totalReimbursement = expenseTotal + mileageReimbursementTotal;
    const actionsDisabled =
        mutation.isPending || draftLoadFailed || contentLoadFailed;

    return (
        <section
            className="submit-expense-screen"
            aria-labelledby="submit-expense-heading"
        >
            <header className="submit-expense-screen__header">
                <p className="screen-placeholder__label">Employee Portal</p>
                <h2 id="submit-expense-heading">Submit Expense</h2>
                <p>
                    Save expenses and mileage to one draft, then submit the
                    complete report for review.
                </p>
                <span className="badge badge--neutral">
                    {activeDraftId === undefined ? "New Draft" : "Drafted"}
                </span>
            </header>

            {draftLoadFailed || contentLoadFailed ? (
                <p className="submit-expense-alert" role="alert">
                    Unable to load your draft. Try again before continuing.
                </p>
            ) : null}

            <form
                className="submit-expense-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    runAction("submit");
                }}
            >
                <aside
                    aria-labelledby="expense-guidance-heading"
                    className="submit-expense-guidance"
                >
                    <h3 id="expense-guidance-heading">What goes where?</h3>
                    <div>
                        <p>
                            <strong>Expenses:</strong> Purchases such as
                            airfare, lodging, meals, rental cars, and
                            rideshares.
                        </p>
                        <p>
                            <strong>Mileage:</strong> Business miles driven in
                            your personal vehicle. Do not log distance traveled
                            by plane, rental car, rideshare, or other paid
                            transportation.
                        </p>
                    </div>
                </aside>

                {savedContent.lineItems.length > 0 ||
                savedContent.mileageEntries.length > 0 ? (
                    <SavedDraftContent content={savedContent} />
                ) : null}

                <div className="submit-expense-card">
                    <div className="submit-expense-card__heading">
                        <div>
                            <h3>New line items</h3>
                            <p>
                                Add expenses that are not already in the draft.
                            </p>
                        </div>
                        <button
                            className="button button--secondary"
                            disabled={
                                savedContent.lineItems.length +
                                    lineItems.length >=
                                50
                            }
                            onClick={() =>
                                setLineItems((current) => [
                                    ...current,
                                    emptyLineItem(),
                                ])
                            }
                            type="button"
                        >
                            Add line item
                        </button>
                    </div>

                    <div className="submit-expense-lines">
                        {lineItems.length === 0 ? (
                            <p className="submit-expense-lines__empty">
                                All entered line items are saved. Add another
                                line item or continue to mileage.
                            </p>
                        ) : (
                            lineItems.map((item, index) => (
                                <LineItemEditor
                                    displayNumber={
                                        savedContent.lineItems.length +
                                        index +
                                        1
                                    }
                                    errors={errors}
                                    index={index}
                                    item={item}
                                    key={index}
                                    onChange={(nextItem) =>
                                        setLineItems((current) =>
                                            current.map(
                                                (currentItem, itemIndex) =>
                                                    itemIndex === index
                                                        ? nextItem
                                                        : currentItem,
                                            ),
                                        )
                                    }
                                    onRemove={() =>
                                        setLineItems((current) =>
                                            current.filter(
                                                (_, itemIndex) =>
                                                    itemIndex !== index,
                                            ),
                                        )
                                    }
                                    removable={
                                        lineItems.length > 1 ||
                                        savedContent.lineItems.length > 0
                                    }
                                />
                            ))
                        )}
                    </div>
                </div>

                {errors._form === undefined ? null : (
                    <p className="submit-expense-alert" role="alert">
                        {errors._form}
                    </p>
                )}
                {mutation.error === null ? null : (
                    <p className="submit-expense-alert" role="alert">
                        {getErrorMessage(mutation.error)}
                    </p>
                )}
                {successMessage === null ? null : (
                    <p className="submit-expense-success-message" role="status">
                        {successMessage}
                    </p>
                )}

                <footer className="submit-expense-actions">
                    <dl
                        aria-label="Draft reimbursement summary"
                        className="submit-expense-reimbursement-summary"
                        role="group"
                    >
                        <div>
                            <dt>Expense reimbursement</dt>
                            <dd>{formatCurrency(expenseTotal)}</dd>
                        </div>
                        <div>
                            <dt>Mileage reimbursement</dt>
                            <dd>{formatCurrency(mileageReimbursementTotal)}</dd>
                        </div>
                        <div className="submit-expense-reimbursement-summary__total">
                            <dt>Total reimbursement</dt>
                            <dd>{formatCurrency(totalReimbursement)}</dd>
                        </div>
                    </dl>
                    <div className="submit-expense-actions__buttons">
                        <button
                            className="button button--secondary"
                            disabled={actionsDisabled}
                            onClick={() => runAction("save")}
                            type="button"
                        >
                            {mutation.isPending ? "Saving..." : "Save Draft"}
                        </button>
                        <button
                            className="button button--secondary"
                            disabled={actionsDisabled}
                            onClick={() => runAction("mileage")}
                            type="button"
                        >
                            Save Draft &amp; Log Mileage
                        </button>
                        <button
                            className="button button--primary"
                            disabled={actionsDisabled}
                            type="submit"
                        >
                            {mutation.isPending
                                ? "Working..."
                                : "Submit Expense Report"}
                        </button>
                    </div>
                </footer>
            </form>
        </section>
    );
}

function SavedDraftContent({
    content,
}: {
    content: DraftExpenseContent;
}): JSX.Element {
    return (
        <section
            className="submit-expense-card submit-expense-saved"
            aria-labelledby="saved-draft-heading"
        >
            <div className="submit-expense-card__heading">
                <div>
                    <h3 id="saved-draft-heading">Saved in this draft</h3>
                    <p>These entries will be included in final submission.</p>
                </div>
            </div>
            <ul className="submit-expense-saved__list">
                {content.lineItems.map((item) => (
                    <li key={item.id}>
                        <div>
                            <strong>{item.merchant}</strong>
                            <span>
                                {item.expenseDate} · {item.category}
                            </span>
                        </div>
                        <strong>{formatCurrency(item.amount)}</strong>
                    </li>
                ))}
                {content.mileageEntries.map((entry) => (
                    <li key={entry.id}>
                        <div>
                            <strong>{entry.route}</strong>
                            <span>
                                {entry.mileageDate} · Mileage · {entry.distance}{" "}
                                miles
                            </span>
                        </div>
                        <div className="submit-expense-saved__amount">
                            <strong>
                                {formatCurrency(entry.reimbursementAmount)}
                            </strong>
                        </div>
                    </li>
                ))}
            </ul>
            <p className="submit-expense-saved__receipts">
                {content.receipts.length} receipt
                {content.receipts.length === 1 ? "" : "s"} attached
            </p>
        </section>
    );
}

function LineItemEditor({
    displayNumber,
    errors,
    index,
    item,
    onChange,
    onRemove,
    removable,
}: {
    displayNumber: number;
    errors: Record<string, string>;
    index: number;
    item: EditableLineItem;
    onChange: (item: EditableLineItem) => void;
    onRemove: () => void;
    removable: boolean;
}): JSX.Element {
    const fieldId = (field: keyof EditableLineItem): string =>
        `lineItems.${index}.${field}`;

    return (
        <fieldset className="submit-expense-line">
            <legend>Line item {displayNumber}</legend>
            <ExpenseField
                error={errors[fieldId("merchant")]}
                id={fieldId("merchant")}
                label="Merchant"
            >
                <input
                    id={fieldId("merchant")}
                    onChange={(event) =>
                        onChange({ ...item, merchant: event.target.value })
                    }
                    type="text"
                    value={item.merchant}
                />
            </ExpenseField>
            <ExpenseField
                error={errors[fieldId("expenseDate")]}
                id={fieldId("expenseDate")}
                label="Expense date"
            >
                <input
                    id={fieldId("expenseDate")}
                    max={getToday()}
                    onChange={(event) =>
                        onChange({ ...item, expenseDate: event.target.value })
                    }
                    type="date"
                    value={item.expenseDate}
                />
            </ExpenseField>
            <ExpenseField
                error={errors[fieldId("category")]}
                id={fieldId("category")}
                label="Category"
            >
                <select
                    id={fieldId("category")}
                    onChange={(event) =>
                        onChange({
                            ...item,
                            category: event.target
                                .value as EditableLineItem["category"],
                        })
                    }
                    value={item.category}
                >
                    <option value="">Choose a category</option>
                    {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                            {category}
                        </option>
                    ))}
                </select>
            </ExpenseField>
            <ExpenseField
                error={errors[fieldId("amount")]}
                id={fieldId("amount")}
                label="Amount (USD)"
            >
                <input
                    id={fieldId("amount")}
                    inputMode="decimal"
                    min="0.01"
                    onChange={(event) =>
                        onChange({ ...item, amount: event.target.value })
                    }
                    step="0.01"
                    type="number"
                    value={item.amount}
                />
            </ExpenseField>
            <ExpenseField
                error={errors[fieldId("receipt")]}
                id={fieldId("receipt")}
                label="Receipt"
            >
                <input
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    id={fieldId("receipt")}
                    onChange={(event) =>
                        onChange({
                            ...item,
                            receipt: event.target.files?.[0] ?? null,
                        })
                    }
                    type="file"
                />
                <small>PDF, PNG, JPG, or WebP · 10 MB maximum</small>
            </ExpenseField>
            {removable ? (
                <button
                    className="submit-expense-line__remove"
                    onClick={onRemove}
                    type="button"
                >
                    Remove line item {displayNumber}
                </button>
            ) : null}
        </fieldset>
    );
}

function ExpenseField({
    children,
    error,
    id,
    label,
}: {
    children: ReactNode;
    error?: string;
    id: string;
    label: string;
}): JSX.Element {
    return (
        <div className="submit-expense-field">
            <label htmlFor={id}>{label}</label>
            {children}
            {error === undefined ? null : (
                <span className="submit-expense-field__error" role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}

function mergeSavedDraftContent(
    current: DraftExpenseContent,
    result: DraftMutationResult,
): DraftExpenseContent {
    if (result.addedContent === null) {
        return { ...current, expenseReportId: result.reportId };
    }

    const addedContent = result.addedContent;
    let receiptIndex = 0;
    const newReceipts = result.values.lineItems.flatMap((item) => {
        if (item.receipt === null) {
            return [];
        }

        const receiptId = addedContent.receiptIds[receiptIndex];
        receiptIndex += 1;

        return receiptId === undefined
            ? []
            : [
                  {
                      id: receiptId,
                      filename: item.receipt.name,
                      merchant: item.merchant,
                      receiptDate: item.expenseDate,
                      amount: item.amount,
                  },
              ];
    });

    return {
        ...current,
        expenseReportId: result.reportId,
        lineItems: [
            ...current.lineItems,
            ...result.values.lineItems.map((item, index) => ({
                id: addedContent.lineItemIds[index] ?? crypto.randomUUID(),
                merchant: item.merchant,
                expenseDate: item.expenseDate,
                category: item.category,
                amount: item.amount,
                currency: "USD" as const,
            })),
        ],
        receipts: [...current.receipts, ...newReceipts],
    };
}

function hasLineItemInput(item: EditableLineItem): boolean {
    return (
        item.merchant.trim().length > 0 ||
        item.expenseDate.length > 0 ||
        item.category.length > 0 ||
        item.amount.trim().length > 0 ||
        item.receipt !== null
    );
}

function toFieldErrors(issues: ZodIssue[]): Record<string, string> {
    return issues.reduce<Record<string, string>>((fieldErrors, issue) => {
        const path = issue.path.join(".");
        if (fieldErrors[path] === undefined) {
            fieldErrors[path] = issue.message;
        }

        return fieldErrors;
    }, {});
}

function getToday(): string {
    return new Date().toISOString().slice(0, 10);
}

function getDueDate(): string {
    const dueDate = new Date();
    dueDate.setUTCDate(dueDate.getUTCDate() + 30);
    return dueDate.toISOString().slice(0, 10);
}

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(amount);
}

class SubmitExpenseRequestError extends Error {}

async function createSubmitExpenseRequestError(
    response: Response,
): Promise<SubmitExpenseRequestError> {
    const body = (await response.json().catch(() => null)) as {
        detail?: unknown;
    } | null;
    const detail =
        typeof body?.detail === "string"
            ? body.detail
            : "Unable to update the Expense Report.";

    return new SubmitExpenseRequestError(detail);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : "Unable to update the Expense Report.";
}
