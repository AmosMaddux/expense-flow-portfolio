import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

type DraftSelection = Record<string, string>;

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

/**
 * Renders the role-aware GL Mapping reference screen.
 */
export function GlMappingScreen(): JSX.Element {
    const session = useSession();
    const queryClient = useQueryClient();
    const query = useGlMappingReference();
    const [draftSelection, setDraftSelection] = useState<DraftSelection>({});
    const canEdit = session.user?.roles.includes("Finance Admin") ?? false;
    const mappings = query.data?.mappings ?? [];
    const glCodes = query.data?.glCodes ?? [];
    const glCodeOptions = useMemo(
        () =>
            glCodes.map((code) => ({
                ...code,
                label: `${code.accountCode} - ${code.accountName}`,
            })),
        [glCodes],
    );
    const mutation = useMutation({
        mutationFn: async ({
            glCodeId,
            mappingId,
        }: {
            glCodeId: string;
            mappingId: string;
        }) => {
            const response = await session.authenticatedFetch(
                `/v1/gl-mappings/${mappingId}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ glCodeId }),
                },
            );

            if (!response.ok) {
                throw await createMutationRequestError(response);
            }

            return glMappingSchema.parse(await response.json());
        },
        onSuccess: async (_mapping, variables) => {
            setDraftSelection((current) => {
                const next = { ...current };
                delete next[variables.mappingId];
                return next;
            });
            if (session.user !== null) {
                await queryClient.invalidateQueries({
                    queryKey: createTenantQueryKey(session.user, [
                        "gl-mappings",
                    ]),
                });
            }
        },
    });

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
            ) : mappings.length === 0 ? (
                <EmptyState
                    body="No account mappings are configured for this tenant."
                    title="No GL mappings found"
                />
            ) : (
                <GlMappingTable
                    canEdit={canEdit}
                    draftSelection={draftSelection}
                    glCodeOptions={glCodeOptions}
                    isSaving={mutation.isPending}
                    mappings={mappings}
                    onCancel={(mappingId) =>
                        setDraftSelection((current) => {
                            const next = { ...current };
                            delete next[mappingId];
                            return next;
                        })
                    }
                    onChange={(mappingId, glCodeId) =>
                        setDraftSelection((current) => ({
                            ...current,
                            [mappingId]: glCodeId,
                        }))
                    }
                    onSave={(mappingId, glCodeId) =>
                        mutation.mutate({ mappingId, glCodeId })
                    }
                />
            )}
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
    draftSelection,
    glCodeOptions,
    isSaving,
    mappings,
    onCancel,
    onChange,
    onSave,
}: {
    canEdit: boolean;
    draftSelection: DraftSelection;
    glCodeOptions: Array<GlCode & { label: string }>;
    isSaving: boolean;
    mappings: GlMapping[];
    onCancel: (mappingId: string) => void;
    onChange: (mappingId: string, glCodeId: string) => void;
    onSave: (mappingId: string, glCodeId: string) => void;
}): JSX.Element {
    return (
        <div className="gl-mapping-table">
            <table>
                <caption>
                    Tenant-scoped category to account mappings from gl_mapping
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Category</th>
                        <th scope="col">Account</th>
                        <th scope="col">Description</th>
                        <th scope="col">Last Updated</th>
                        {canEdit ? <th scope="col">Actions</th> : null}
                    </tr>
                </thead>
                <tbody>
                    {mappings.map((mapping) => {
                        const selectedGlCodeId =
                            draftSelection[mapping.id] ?? mapping.glCodeId;
                        const hasChanges =
                            selectedGlCodeId !== mapping.glCodeId;

                        return (
                            <tr key={mapping.id}>
                                <th scope="row">{mapping.category}</th>
                                <td>
                                    {canEdit ? (
                                        <select
                                            aria-label={`${mapping.category} GL account`}
                                            disabled={isSaving}
                                            onChange={(event) =>
                                                onChange(
                                                    mapping.id,
                                                    event.target.value,
                                                )
                                            }
                                            value={selectedGlCodeId}
                                        >
                                            {glCodeOptions.map((code) => (
                                                <option
                                                    key={code.id}
                                                    value={code.id}
                                                >
                                                    {code.label}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span>
                                            {mapping.accountCode} -{" "}
                                            {mapping.accountName}
                                        </span>
                                    )}
                                </td>
                                <td>{mapping.description ?? "-"}</td>
                                <td>
                                    <time dateTime={mapping.updatedAt}>
                                        {formatDateTime(mapping.updatedAt)}
                                    </time>
                                </td>
                                {canEdit ? (
                                    <td>
                                        <div className="gl-mapping-table__actions">
                                            <Button
                                                disabled={
                                                    !hasChanges || isSaving
                                                }
                                                onClick={() =>
                                                    onSave(
                                                        mapping.id,
                                                        selectedGlCodeId,
                                                    )
                                                }
                                                size="sm"
                                                type="button"
                                                variant="primary"
                                            >
                                                {isSaving
                                                    ? "Saving..."
                                                    : "Save"}
                                            </Button>
                                            <Button
                                                disabled={
                                                    !hasChanges || isSaving
                                                }
                                                onClick={() =>
                                                    onCancel(mapping.id)
                                                }
                                                size="sm"
                                                type="button"
                                                variant="secondary"
                                            >
                                                Cancel
                                            </Button>
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
