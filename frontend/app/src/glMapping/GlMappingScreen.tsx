import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { useSession } from "../auth";
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
} from "../components";
import {
    QueryRequestError,
    createTenantQueryKey,
    useExpenseFlowQuery,
} from "../query/queryClient";

const CATEGORY_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;

const glCodeSchema = z.object({
    id: z.string().uuid(),
    accountCode: z.string().min(1),
    accountName: z.string().min(1),
    description: z.string().nullable(),
});

const glMappingSchema = z.object({
    id: z.string().uuid(),
    category: z.string().min(1),
    glCodeId: z.string().uuid(),
    accountCode: z.string().min(1),
    accountName: z.string().min(1),
    description: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
});

const glMappingReferenceSchema = z.object({
    mappings: z.array(glMappingSchema),
    glCodes: z.array(glCodeSchema),
});

export type GlCode = z.infer<typeof glCodeSchema>;
export type GlMapping = z.infer<typeof glMappingSchema>;
export type GlMappingReference = z.infer<typeof glMappingReferenceSchema>;

type RowDraft = {
    category: string;
    accountCode: string;
    description: string;
};

type NewRow = RowDraft & { clientId: string };

type SaveGlMappingsRequest = {
    creates: Array<{
        clientId: string;
        category: string;
        accountCode: string;
        description: string | null;
    }>;
    updates: Array<{
        id: string;
        category: string;
        accountCode: string;
        description: string | null;
    }>;
    deletes: string[];
};

/**
 * Fetches tenant-scoped GL Mapping reference data for the internal workspace.
 */
export function useGlMappingReference() {
    return useExpenseFlowQuery<GlMappingReference>({
        input: "/v1/gl-mappings",
        keyParts: ["gl-mappings"],
        parseResponse: async (response) =>
            glMappingReferenceSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

function createClientId(): string {
    return typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toRowDraft(mapping: GlMapping): RowDraft {
    return {
        category: mapping.category,
        accountCode: mapping.accountCode,
        description: mapping.description ?? "",
    };
}

function validateRowDraft(draft: RowDraft): string | null {
    const category = draft.category.trim();
    const accountCode = draft.accountCode.trim();
    const description = draft.description.trim();

    if (category.length === 0) {
        return "Title is required.";
    }
    if (category.length > CATEGORY_MAX_LENGTH) {
        return `Title must be ${CATEGORY_MAX_LENGTH} characters or fewer.`;
    }
    if (accountCode.length === 0) {
        return "GL number is required.";
    }
    if (!/^\d+$/.test(accountCode)) {
        return "GL number must contain only digits.";
    }
    if (description.length > DESCRIPTION_MAX_LENGTH) {
        return `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }

    return null;
}

/**
 * Renders the role-aware GL Mapping reference screen. Finance Admins can
 * add, edit, and delete mappings; edits are staged locally until Save.
 */
export function GlMappingScreen(): JSX.Element {
    const session = useSession();
    const queryClient = useQueryClient();
    const query = useGlMappingReference();
    const canEdit = session.user?.roles.includes("Finance Admin") ?? false;
    const mappings = query.data?.mappings ?? [];

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<RowDraft | null>(null);
    const [rowEdits, setRowEdits] = useState<Record<string, RowDraft>>({});
    const [newRows, setNewRows] = useState<NewRow[]>([]);
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
    const [validationError, setValidationError] = useState<string | null>(
        null,
    );

    const hasPendingChanges =
        Object.keys(rowEdits).length > 0 ||
        newRows.length > 0 ||
        deletedIds.size > 0;

    const mutation = useMutation({
        mutationFn: async (body: SaveGlMappingsRequest) => {
            const response = await session.authenticatedFetch(
                "/v1/gl-mappings",
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                },
            );

            if (!response.ok) {
                throw await createMutationRequestError(response);
            }

            return glMappingReferenceSchema.parse(await response.json());
        },
        onSuccess: async (reference) => {
            setRowEdits({});
            setNewRows([]);
            setDeletedIds(new Set());
            setEditingId(null);
            setEditingDraft(null);
            setValidationError(null);
            if (session.user !== null) {
                queryClient.setQueryData(
                    createTenantQueryKey(session.user, ["gl-mappings"]),
                    reference,
                );
            }
        },
    });

    function startEditingExisting(mapping: GlMapping) {
        setEditingId(mapping.id);
        setEditingDraft(rowEdits[mapping.id] ?? toRowDraft(mapping));
        setValidationError(null);
    }

    function startEditingNew(row: NewRow) {
        setEditingId(row.clientId);
        setEditingDraft({
            category: row.category,
            accountCode: row.accountCode,
            description: row.description,
        });
        setValidationError(null);
    }

    function cancelEditing() {
        setEditingId(null);
        setEditingDraft(null);
        setValidationError(null);
    }

    function commitEditingExisting(id: string) {
        if (editingDraft === null) {
            return;
        }
        const error = validateRowDraft(editingDraft);
        if (error !== null) {
            setValidationError(error);
            return;
        }
        setRowEdits((current) => ({ ...current, [id]: editingDraft }));
        setEditingId(null);
        setEditingDraft(null);
        setValidationError(null);
    }

    function commitEditingNew(clientId: string) {
        if (editingDraft === null) {
            return;
        }
        const error = validateRowDraft(editingDraft);
        if (error !== null) {
            setValidationError(error);
            return;
        }
        setNewRows((current) =>
            current.map((row) =>
                row.clientId === clientId
                    ? { ...editingDraft, clientId }
                    : row,
            ),
        );
        setEditingId(null);
        setEditingDraft(null);
        setValidationError(null);
    }

    function addMapping() {
        const clientId = createClientId();
        const blankRow: NewRow = {
            clientId,
            category: "",
            accountCode: "",
            description: "",
        };
        setNewRows((current) => [...current, blankRow]);
        startEditingNew(blankRow);
    }

    function deleteExisting(id: string) {
        setDeletedIds((current) => new Set(current).add(id));
        setRowEdits((current) => {
            const next = { ...current };
            delete next[id];
            return next;
        });
        if (editingId === id) {
            cancelEditing();
        }
    }

    function deleteNew(clientId: string) {
        setNewRows((current) =>
            current.filter((row) => row.clientId !== clientId),
        );
        if (editingId === clientId) {
            cancelEditing();
        }
    }

    function handleSave() {
        const body: SaveGlMappingsRequest = {
            creates: newRows.map((row) => ({
                clientId: row.clientId,
                category: row.category.trim(),
                accountCode: row.accountCode.trim(),
                description:
                    row.description.trim().length === 0
                        ? null
                        : row.description.trim(),
            })),
            updates: Object.entries(rowEdits).map(([id, draft]) => ({
                id,
                category: draft.category.trim(),
                accountCode: draft.accountCode.trim(),
                description:
                    draft.description.trim().length === 0
                        ? null
                        : draft.description.trim(),
            })),
            deletes: [...deletedIds],
        };

        mutation.mutate(body);
    }

    const visibleMappings = mappings.filter(
        (mapping) => !deletedIds.has(mapping.id),
    );

    return (
        <section className="gl-mapping" aria-labelledby="gl-mapping-heading">
            <header className="gl-mapping__header">
                <div>
                    <p className="screen-placeholder__label">GL Mapping</p>
                    <h2 id="gl-mapping-heading">Account Mappings</h2>
                </div>
                <Badge tone={canEdit ? "success" : "neutral"}>
                    {canEdit ? "Editable" : "Read-only"}
                </Badge>
            </header>

            {query.isPending ? (
                <LoadingSkeleton label="Loading GL Mapping" rows={5} />
            ) : query.isError ? (
                <ErrorState
                    isRetrying={query.isFetching}
                    message={getGlMappingErrorMessage(query.error)}
                    onRetry={() => {
                        void query.refetch();
                    }}
                    title="Unable to load GL Mapping"
                />
            ) : visibleMappings.length === 0 && newRows.length === 0 ? (
                <EmptyState
                    body="No account mappings are configured for this tenant."
                    title="No GL mappings found"
                />
            ) : (
                <GlMappingTable
                    canEdit={canEdit}
                    editingDraft={editingDraft}
                    editingId={editingId}
                    isSaving={mutation.isPending}
                    mappings={visibleMappings}
                    newRows={newRows}
                    rowEdits={rowEdits}
                    onCancelEdit={cancelEditing}
                    onChangeDraft={setEditingDraft}
                    onCommitExisting={commitEditingExisting}
                    onCommitNew={commitEditingNew}
                    onDeleteExisting={deleteExisting}
                    onDeleteNew={deleteNew}
                    onStartEditExisting={startEditingExisting}
                    onStartEditNew={startEditingNew}
                />
            )}

            {canEdit &&
            !query.isPending &&
            !query.isError ? (
                <div className="gl-mapping__footer">
                    <Button
                        disabled={mutation.isPending || editingId !== null}
                        onClick={addMapping}
                        size="sm"
                        type="button"
                        variant="secondary"
                    >
                        Add mapping
                    </Button>
                    <Button
                        disabled={
                            !hasPendingChanges ||
                            mutation.isPending ||
                            editingId !== null
                        }
                        onClick={handleSave}
                        size="sm"
                        type="button"
                        variant="primary"
                    >
                        {mutation.isPending ? "Saving..." : "Save"}
                    </Button>
                </div>
            ) : null}

            {validationError !== null ? (
                <p className="gl-mapping__error" role="alert">
                    {validationError}
                </p>
            ) : null}
            {mutation.isError ? (
                <p className="gl-mapping__error" role="alert">
                    {getGlMappingErrorMessage(mutation.error)}
                </p>
            ) : null}
        </section>
    );
}

function GlMappingTable({
    canEdit,
    editingDraft,
    editingId,
    isSaving,
    mappings,
    newRows,
    rowEdits,
    onCancelEdit,
    onChangeDraft,
    onCommitExisting,
    onCommitNew,
    onDeleteExisting,
    onDeleteNew,
    onStartEditExisting,
    onStartEditNew,
}: {
    canEdit: boolean;
    editingDraft: RowDraft | null;
    editingId: string | null;
    isSaving: boolean;
    mappings: GlMapping[];
    newRows: NewRow[];
    rowEdits: Record<string, RowDraft>;
    onCancelEdit: () => void;
    onChangeDraft: (draft: RowDraft) => void;
    onCommitExisting: (id: string) => void;
    onCommitNew: (clientId: string) => void;
    onDeleteExisting: (id: string) => void;
    onDeleteNew: (clientId: string) => void;
    onStartEditExisting: (mapping: GlMapping) => void;
    onStartEditNew: (row: NewRow) => void;
}): JSX.Element {
    return (
        <div className="gl-mapping-table">
            <table>
                <caption>
                    Tenant-scoped category to account mappings from gl_mapping
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Title</th>
                        <th scope="col">GL Number</th>
                        <th scope="col">Description</th>
                        <th scope="col">Last Updated</th>
                        {canEdit ? <th scope="col">Actions</th> : null}
                    </tr>
                </thead>
                <tbody>
                    {mappings.map((mapping) => {
                        const isEditingRow = editingId === mapping.id;
                        const pendingDraft = rowEdits[mapping.id];
                        const displayed = pendingDraft ?? toRowDraft(mapping);

                        return (
                            <tr key={mapping.id}>
                                {isEditingRow && editingDraft !== null ? (
                                    <GlMappingEditableCells
                                        draft={editingDraft}
                                        onChangeDraft={onChangeDraft}
                                    />
                                ) : (
                                    <>
                                        <th scope="row">
                                            {displayed.category}
                                        </th>
                                        <td>{displayed.accountCode}</td>
                                        <td>{displayed.description || "-"}</td>
                                    </>
                                )}
                                {isEditingRow ? null : (
                                    <td>
                                        <time dateTime={mapping.updatedAt}>
                                            {formatDateTime(
                                                mapping.updatedAt,
                                            )}
                                        </time>
                                    </td>
                                )}
                                {canEdit ? (
                                    <td>
                                        <div className="gl-mapping-table__actions">
                                            {isEditingRow ? (
                                                <>
                                                    <Button
                                                        aria-label={`Save ${displayed.category || "mapping"} edits`}
                                                        disabled={isSaving}
                                                        onClick={() =>
                                                            onCommitExisting(
                                                                mapping.id,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="primary"
                                                    >
                                                        ✓
                                                    </Button>
                                                    <Button
                                                        disabled={isSaving}
                                                        onClick={onCancelEdit}
                                                        size="sm"
                                                        type="button"
                                                        variant="secondary"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        disabled={
                                                            isSaving ||
                                                            editingId !== null
                                                        }
                                                        onClick={() =>
                                                            onStartEditExisting(
                                                                mapping,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="secondary"
                                                    >
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        aria-label={`Delete ${mapping.category}`}
                                                        disabled={
                                                            isSaving ||
                                                            editingId !== null
                                                        }
                                                        onClick={() =>
                                                            onDeleteExisting(
                                                                mapping.id,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="danger"
                                                    >
                                                        🗑
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                ) : null}
                            </tr>
                        );
                    })}
                    {newRows.map((row) => {
                        const isEditingRow = editingId === row.clientId;
                        const displayed: RowDraft = isEditingRow
                            ? (editingDraft ?? row)
                            : row;

                        return (
                            <tr key={row.clientId}>
                                {isEditingRow && editingDraft !== null ? (
                                    <GlMappingEditableCells
                                        draft={editingDraft}
                                        onChangeDraft={onChangeDraft}
                                    />
                                ) : (
                                    <>
                                        <th scope="row">
                                            {displayed.category || "(new)"}
                                        </th>
                                        <td>{displayed.accountCode}</td>
                                        <td>{displayed.description || "-"}</td>
                                    </>
                                )}
                                {isEditingRow ? null : <td>Not saved yet</td>}
                                {canEdit ? (
                                    <td>
                                        <div className="gl-mapping-table__actions">
                                            {isEditingRow ? (
                                                <>
                                                    <Button
                                                        aria-label={`Save ${displayed.category || "new mapping"}`}
                                                        disabled={isSaving}
                                                        onClick={() =>
                                                            onCommitNew(
                                                                row.clientId,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="primary"
                                                    >
                                                        ✓
                                                    </Button>
                                                    <Button
                                                        disabled={isSaving}
                                                        onClick={onCancelEdit}
                                                        size="sm"
                                                        type="button"
                                                        variant="secondary"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        disabled={
                                                            isSaving ||
                                                            editingId !== null
                                                        }
                                                        onClick={() =>
                                                            onStartEditNew(
                                                                row,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="secondary"
                                                    >
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        aria-label={`Remove ${displayed.category || "new mapping"}`}
                                                        disabled={
                                                            isSaving ||
                                                            editingId !== null
                                                        }
                                                        onClick={() =>
                                                            onDeleteNew(
                                                                row.clientId,
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="danger"
                                                    >
                                                        🗑
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                ) : null}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function GlMappingEditableCells({
    draft,
    onChangeDraft,
}: {
    draft: RowDraft;
    onChangeDraft: (draft: RowDraft) => void;
}): JSX.Element {
    return (
        <>
            <td>
                <input
                    aria-label="Title"
                    className="gl-mapping-table__input"
                    maxLength={CATEGORY_MAX_LENGTH}
                    type="text"
                    value={draft.category}
                    onChange={(event) =>
                        onChangeDraft({
                            ...draft,
                            category: event.target.value,
                        })
                    }
                />
            </td>
            <td>
                <input
                    aria-label="GL number"
                    className="gl-mapping-table__input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    type="text"
                    value={draft.accountCode}
                    onChange={(event) =>
                        onChangeDraft({
                            ...draft,
                            accountCode: event.target.value,
                        })
                    }
                />
            </td>
            <td>
                <input
                    aria-label="Description"
                    className="gl-mapping-table__input"
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    type="text"
                    value={draft.description}
                    onChange={(event) =>
                        onChangeDraft({
                            ...draft,
                            description: event.target.value,
                        })
                    }
                />
            </td>
        </>
    );
}

async function createMutationRequestError(
    response: Response,
): Promise<QueryRequestError> {
    const body: unknown = await response.json().catch(() => undefined);
    const detail =
        body !== null &&
        typeof body === "object" &&
        "detail" in body &&
        typeof body.detail === "string"
            ? body.detail
            : response.statusText;

    return new QueryRequestError(response.status, detail, body);
}

function getGlMappingErrorMessage(error: Error | null): string {
    if (error instanceof QueryRequestError) {
        return error.message;
    }

    return "The GL Mapping reference data could not be loaded or saved. Retry the request or sign in again if the problem continues.";
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}
