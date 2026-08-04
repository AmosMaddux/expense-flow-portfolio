import { z } from "zod";

import { ErrorState, LoadingSkeleton } from "../components";
import { QueryRequestError, useExpenseFlowQuery } from "../query/queryClient";

const policyReferenceResponseSchema = z.object({
    policyText: z.string().refine((value) => value.trim().length > 0, {
        message: "Policy text must not be blank.",
    }),
    updatedAt: z.string().datetime({ offset: true }),
});

export type PolicyReference = z.infer<typeof policyReferenceResponseSchema>;

/**
 * Fetches the authenticated tenant's read-only expense policy reference.
 */
export function usePolicyReference() {
    return useExpenseFlowQuery<PolicyReference>({
        input: "/v1/policy-reference",
        keyParts: ["policy-reference"],
        parseResponse: async (response) =>
            policyReferenceResponseSchema.parse(await response.json()),
        staleTime: 60_000,
    });
}

/**
 * Renders the tenant-scoped Policy Reference workspace.
 */
export function PolicyReferenceScreen(): JSX.Element {
    const policyQuery = usePolicyReference();

    if (policyQuery.isError) {
        return (
            <section
                className="policy-reference"
                aria-labelledby="policy-reference-heading"
            >
                <PolicyReferenceHeader />
                <ErrorState
                    isRetrying={policyQuery.isFetching}
                    message={getPolicyReferenceErrorMessage(policyQuery.error)}
                    onRetry={() => {
                        void policyQuery.refetch();
                    }}
                    title="Unable to load Policy Reference"
                />
            </section>
        );
    }

    if (policyQuery.isLoading || policyQuery.data === undefined) {
        return (
            <section
                className="policy-reference"
                aria-labelledby="policy-reference-heading"
            >
                <PolicyReferenceHeader />
                <LoadingSkeleton label="Loading Policy Reference" rows={5} />
            </section>
        );
    }

    return (
        <section
            className="policy-reference"
            aria-labelledby="policy-reference-heading"
        >
            <PolicyReferenceHeader />
            <article className="policy-reference__document">
                <p className="policy-reference__updated">
                    Last updated {formatDateTime(policyQuery.data.updatedAt)}
                </p>
                <div className="policy-reference__text">
                    {policyQuery.data.policyText}
                </div>
            </article>
        </section>
    );
}

function PolicyReferenceHeader(): JSX.Element {
    return (
        <header className="policy-reference__header">
            <p className="screen-placeholder__label">Policy Reference</p>
            <h2 id="policy-reference-heading">Policy Reference</h2>
        </header>
    );
}

function getPolicyReferenceErrorMessage(error: Error): string {
    if (error instanceof QueryRequestError && error.status === 404) {
        return "No expense policy has been configured for this organization.";
    }

    return error.message;
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
    }).format(new Date(value));
}
