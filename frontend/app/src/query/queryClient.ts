import { QueryClient } from "@tanstack/react-query";

import {
    AuthRequestError,
    type SessionContextValue,
    type SessionUser,
} from "../auth";

export type AuthenticatedQueryRequest<TData> = {
    input: RequestInfo | URL;
    init?: RequestInit;
    parseResponse?: (response: Response) => Promise<TData> | TData;
};

/** Represents a rejected request to a read-model or BFF API. */
export class QueryRequestError extends Error {
    public readonly status: number;

    /** Creates a query request error with its HTTP response status. */
    public constructor(status: number, message: string) {
        super(message);
        this.name = "QueryRequestError";
        this.status = status;
    }
}

/**
 * Builds a tenant-scoped query key so cached data cannot cross tenant sessions.
 */
export function createTenantQueryKey(
    user: SessionUser,
    keyParts: readonly unknown[],
): readonly unknown[] {
    return ["tenant", user.tenantId, ...keyParts];
}

/**
 * Creates a TanStack Query function backed by the authenticated session fetcher.
 */
export function createAuthenticatedQueryFn<TData>(
    session: Pick<SessionContextValue, "authenticatedFetch">,
    request: AuthenticatedQueryRequest<TData>,
): () => Promise<TData> {
    return async () => {
        const response = await session.authenticatedFetch(
            request.input,
            request.init,
        );

        if (response.status === 401) {
            throw new AuthRequestError(401, "Authentication was rejected.");
        }

        if (!response.ok) {
            throw new QueryRequestError(
                response.status,
                "Query request failed.",
            );
        }

        if (request.parseResponse !== undefined) {
            return request.parseResponse(response);
        }

        return (await response.json()) as TData;
    };
}

/**
 * Returns whether TanStack Query should retry a failed request.
 */
export function shouldRetryQueryFailure(
    failureCount: number,
    error: unknown,
): boolean {
    if (error instanceof AuthRequestError && error.status === 401) {
        return false;
    }

    return failureCount < 2;
}

/**
 * Creates the shared TanStack Query client for tenant-scoped frontend data.
 */
export function createExpenseFlowQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: shouldRetryQueryFailure,
            },
            mutations: {
                retry: false,
            },
        },
    });
}
