import {
    QueryClient,
    useQuery,
    type QueryFunctionContext,
    type UseQueryResult,
} from "@tanstack/react-query";
import { ZodError } from "zod";

import {
    AuthRequestError,
    useSession,
    type SessionContextValue,
    type SessionUser,
} from "../auth";

export type AuthenticatedQueryRequest<TData> = {
    input: RequestInfo | URL;
    init?: RequestInit;
    parseResponse?: (response: Response) => Promise<TData> | TData;
};

export type ExpenseFlowQueryKey = readonly ["tenant", string, ...unknown[]];

export type ExpenseFlowQueryFunction<TData> = (
    context?: QueryFunctionContext<ExpenseFlowQueryKey>,
) => Promise<TData>;

export type ExpenseFlowQueryRequest<TData> =
    AuthenticatedQueryRequest<TData> & {
        enabled?: boolean;
        gcTime?: number;
        keyParts: readonly unknown[];
        refetchOnWindowFocus?: boolean;
        staleTime?: number;
    };

export type ExpenseFlowQueryOptions<TData> = {
    enabled: boolean;
    gcTime?: number;
    queryFn: ExpenseFlowQueryFunction<TData>;
    queryKey: ExpenseFlowQueryKey;
    refetchOnWindowFocus?: boolean;
    staleTime?: number;
};

/** Represents a rejected request to a read-model or BFF API. */
export class QueryRequestError extends Error {
    public readonly status: number;
    public readonly body: unknown;

    /** Creates a query request error with its HTTP response status. */
    public constructor(status: number, message: string, body?: unknown) {
        super(message);
        this.name = "QueryRequestError";
        this.status = status;
        this.body = body;
    }
}

const anonymousSessionUser: SessionUser = {
    id: "anonymous",
    tenantId: "anonymous",
    role: "Employee",
    roles: ["Employee"],
};

/**
 * Builds an authorization-scoped query key so cached data cannot cross sessions.
 */
export function createTenantQueryKey(
    user: SessionUser,
    keyParts: readonly unknown[],
): ExpenseFlowQueryKey {
    return [
        "tenant",
        user.tenantId,
        "principal",
        user.id,
        "roles",
        [...user.roles].sort(),
        ...keyParts,
    ];
}

/**
 * Builds the only supported options shape for authenticated TanStack queries.
 */
export function createExpenseFlowQueryOptions<TData>(
    session: Pick<SessionContextValue, "authenticatedFetch" | "user">,
    request: ExpenseFlowQueryRequest<TData>,
): ExpenseFlowQueryOptions<TData> {
    const queryKey = createTenantQueryKey(
        session.user ?? anonymousSessionUser,
        request.keyParts,
    );

    return {
        enabled: session.user !== null && request.enabled !== false,
        gcTime: request.gcTime,
        queryFn: createAuthenticatedQueryFn(session, request),
        queryKey,
        refetchOnWindowFocus: request.refetchOnWindowFocus,
        staleTime: request.staleTime,
    };
}

/**
 * Creates a TanStack Query function backed by the authenticated session fetcher.
 */
export function createAuthenticatedQueryFn<TData>(
    session: Pick<SessionContextValue, "authenticatedFetch">,
    request: AuthenticatedQueryRequest<TData>,
): ExpenseFlowQueryFunction<TData> {
    return async (
        context?: QueryFunctionContext<ExpenseFlowQueryKey>,
    ): Promise<TData> => {
        const response = await session.authenticatedFetch(
            request.input,
            createRequestInitWithSignal(request.init, context?.signal),
        );

        if (response.status === 401) {
            throw new AuthRequestError(401, "Authentication was rejected.");
        }

        if (!response.ok) {
            throw await createQueryRequestError(response);
        }

        if (request.parseResponse !== undefined) {
            return request.parseResponse(response);
        }

        return readDefaultQueryResponse<TData>(response);
    };
}

/**
 * Runs an authenticated, tenant-scoped TanStack query.
 */
export function useExpenseFlowQuery<TData>(
    request: ExpenseFlowQueryRequest<TData>,
): UseQueryResult<TData, Error> {
    const session = useSession();

    return useQuery<TData, Error, TData, ExpenseFlowQueryKey>(
        createExpenseFlowQueryOptions(session, request),
    );
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

    if (error instanceof QueryRequestError && isTerminalClientError(error)) {
        return false;
    }

    if (error instanceof ZodError) {
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

async function createQueryRequestError(
    response: Response,
): Promise<QueryRequestError> {
    const body = await readResponseBody(response);

    return new QueryRequestError(
        response.status,
        getErrorMessage(body) ?? response.statusText ?? "Query request failed.",
        body,
    );
}

async function readDefaultQueryResponse<TData>(
    response: Response,
): Promise<TData> {
    if (response.status === 204) {
        return undefined as TData;
    }

    const responseText = await response.text();
    if (responseText.length === 0) {
        return undefined as TData;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (isJsonContentType(contentType)) {
        return JSON.parse(responseText) as TData;
    }

    return responseText as TData;
}

async function readResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("Content-Type") ?? "";
    const responseText = await response.text().catch(() => "");
    if (responseText.length === 0) {
        return undefined;
    }

    if (isJsonContentType(contentType)) {
        try {
            return JSON.parse(responseText) as unknown;
        } catch {
            return undefined;
        }
    }

    return responseText;
}

function getErrorMessage(body: unknown): string | undefined {
    if (typeof body === "string") {
        return body.length > 0 ? body : undefined;
    }

    if (body === null || typeof body !== "object") {
        return undefined;
    }

    const record = body as Record<string, unknown>;
    for (const field of ["detail", "message", "title"]) {
        const value = record[field];
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }

    return undefined;
}

function isJsonContentType(contentType: string): boolean {
    return (
        contentType.includes("application/json") ||
        contentType.includes("+json")
    );
}

function createRequestInitWithSignal(
    init: RequestInit | undefined,
    signal: AbortSignal | undefined,
): RequestInit | undefined {
    if (signal === undefined) {
        return init;
    }

    return { ...init, signal };
}

function isTerminalClientError(error: QueryRequestError): boolean {
    return (
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
    );
}
