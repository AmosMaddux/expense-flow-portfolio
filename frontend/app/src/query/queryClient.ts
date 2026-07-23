import { QueryClient } from "@tanstack/react-query";

import { AuthRequestError } from "../auth";

/**
 * Creates the shared TanStack Query client for tenant-scoped frontend data.
 */
export function createExpenseFlowQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry(failureCount, error): boolean {
                    if (
                        error instanceof AuthRequestError &&
                        error.status === 401
                    ) {
                        return false;
                    }

                    return failureCount < 2;
                },
            },
            mutations: {
                retry: false,
            },
        },
    });
}
