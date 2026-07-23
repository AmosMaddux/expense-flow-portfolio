import { QueryClient } from "@tanstack/react-query";

import { AuthRequestError } from "../auth";

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
