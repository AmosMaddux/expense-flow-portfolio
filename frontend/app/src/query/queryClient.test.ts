import { describe, expect, test, vi } from "vitest";

import {
    AuthRequestError,
    type SessionContextValue,
    type SessionUser,
} from "../auth";
import {
    QueryRequestError,
    createAuthenticatedQueryFn,
    createExpenseFlowQueryClient,
    createExpenseFlowQueryOptions,
    createTenantQueryKey,
    shouldRetryQueryFailure,
} from "./queryClient";

const tenantOneUser: SessionUser = {
    id: "cf8ea46a-778d-4634-9363-f4864a3d4424",
    tenantId: "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb",
    role: "Finance Admin",
    roles: ["Finance Admin"],
};

const tenantTwoUser: SessionUser = {
    ...tenantOneUser,
    tenantId: "4038c9e3-2223-4fb1-a8f7-3cac30bf4d9a",
};

const sameTenantDepartmentManagerUser: SessionUser = {
    id: "e573b2f9-497e-4bec-a45e-f37e8f6c07a1",
    tenantId: tenantOneUser.tenantId,
    role: "Department Manager",
    roles: ["Department Manager"],
};

function createSession(
    response: Response | (() => Promise<Response> | Response),
): Pick<SessionContextValue, "authenticatedFetch"> {
    return {
        authenticatedFetch: vi.fn(() =>
            Promise.resolve(
                typeof response === "function" ? response() : response,
            ),
        ),
    };
}

function createQuerySession(
    user: SessionUser,
    response: Response | (() => Promise<Response> | Response),
): Pick<SessionContextValue, "authenticatedFetch" | "user"> {
    return {
        ...createSession(response),
        user,
    };
}

describe("createTenantQueryKey", () => {
    test("prefixes query keys with the authenticated tenant and authorization scope", () => {
        expect(
            createTenantQueryKey(tenantOneUser, [
                "case-queue",
                "rollups",
                { asOfDate: "2026-07-22" },
            ]),
        ).toEqual([
            "tenant",
            tenantOneUser.tenantId,
            "principal",
            tenantOneUser.id,
            "roles",
            ["Finance Admin"],
            "case-queue",
            "rollups",
            { asOfDate: "2026-07-22" },
        ]);
    });

    test("keeps the same logical query separate for different tenants", () => {
        const keyParts = ["case-queue", "rollups"];

        expect(createTenantQueryKey(tenantOneUser, keyParts)).not.toEqual(
            createTenantQueryKey(tenantTwoUser, keyParts),
        );
    });

    test("keeps the same logical query separate for different users and roles in one tenant", () => {
        const keyParts = ["case-queue", "rollups"];

        expect(createTenantQueryKey(tenantOneUser, keyParts)).not.toEqual(
            createTenantQueryKey(sameTenantDepartmentManagerUser, keyParts),
        );
    });

    test("sorts roles so equivalent role sets share a stable authorization scope", () => {
        const multiRoleUser = {
            ...tenantOneUser,
            roles: ["Employee", "Finance Admin"],
        } satisfies SessionUser;
        const sameRolesInDifferentOrder = {
            ...tenantOneUser,
            roles: ["Finance Admin", "Employee"],
        } satisfies SessionUser;

        expect(createTenantQueryKey(multiRoleUser, ["case-queue"])).toEqual(
            createTenantQueryKey(sameRolesInDifferentOrder, ["case-queue"]),
        );
    });
});

describe("createAuthenticatedQueryFn", () => {
    test("uses the authenticated fetcher and preserves request options", async () => {
        const session = createSession(
            new Response(JSON.stringify({ total: 3 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const queryFn = createAuthenticatedQueryFn<{ total: number }>(session, {
            input: "/v1/case-queue/rollups?asOfDate=2026-07-22",
            init: { headers: { Accept: "application/json" } },
        });

        await expect(queryFn()).resolves.toEqual({ total: 3 });
        expect(session.authenticatedFetch).toHaveBeenCalledWith(
            "/v1/case-queue/rollups?asOfDate=2026-07-22",
            { headers: { Accept: "application/json" } },
        );
    });

    test("passes the TanStack Query cancellation signal through request options", async () => {
        const session = createSession(
            new Response(JSON.stringify({ total: 3 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const abortController = new AbortController();
        const queryFn = createAuthenticatedQueryFn<{ total: number }>(session, {
            input: "/v1/case-queue/rollups",
            init: {
                headers: { Accept: "application/json" },
                method: "GET",
            },
        });

        await expect(
            queryFn({
                signal: abortController.signal,
            } as Parameters<typeof queryFn>[0]),
        ).resolves.toEqual({ total: 3 });
        expect(session.authenticatedFetch).toHaveBeenCalledWith(
            "/v1/case-queue/rollups",
            {
                headers: { Accept: "application/json" },
                method: "GET",
                signal: abortController.signal,
            },
        );
    });

    test("supports caller-owned response parsing", async () => {
        const session = createSession(new Response(null, { status: 204 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
            parseResponse: (response) => response.status,
        });

        await expect(queryFn()).resolves.toBe(204);
    });

    test("returns undefined for successful empty responses by default", async () => {
        const session = createSession(new Response(null, { status: 204 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).resolves.toBeUndefined();
    });

    test("returns undefined for successful empty json responses by default", async () => {
        const session = createSession(
            new Response("", {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).resolves.toBeUndefined();
    });

    test("returns text for successful non-json responses by default", async () => {
        const session = createSession(
            new Response("synthetic export ready", {
                status: 200,
                headers: { "Content-Type": "text/plain" },
            }),
        );
        const queryFn = createAuthenticatedQueryFn<string>(session, {
            input: "/v1/case-queue/export-status",
        });

        await expect(queryFn()).resolves.toBe("synthetic export ready");
    });

    test("throws a terminal auth error for unrecovered 401 responses", async () => {
        const session = createSession(new Response(null, { status: 401 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).rejects.toBeInstanceOf(AuthRequestError);
    });

    test("throws a query request error for other non-success responses", async () => {
        const problemBody = {
            detail: "Finance Admin role is required.",
            title: "Forbidden",
        };
        const session = createSession(
            new Response(JSON.stringify(problemBody), {
                status: 403,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).rejects.toMatchObject({
            body: problemBody,
            message: "Finance Admin role is required.",
            name: "QueryRequestError",
            status: 403,
        } satisfies Partial<QueryRequestError>);
    });
});

describe("createExpenseFlowQueryOptions", () => {
    test("keeps tenant caches separate through the project query abstraction", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const keyParts = ["case-queue", "rollups"];
        const tenantOneSession = createQuerySession(
            tenantOneUser,
            () =>
                new Response(JSON.stringify({ tenant: "one" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );
        const tenantTwoSession = createQuerySession(
            tenantTwoUser,
            () =>
                new Response(JSON.stringify({ tenant: "two" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );

        await expect(
            queryClient.fetchQuery(
                createExpenseFlowQueryOptions(tenantOneSession, {
                    input: "/v1/case-queue/rollups",
                    keyParts,
                    staleTime: 60_000,
                }),
            ),
        ).resolves.toEqual({ tenant: "one" });
        await expect(
            queryClient.fetchQuery(
                createExpenseFlowQueryOptions(tenantTwoSession, {
                    input: "/v1/case-queue/rollups",
                    keyParts,
                    staleTime: 60_000,
                }),
            ),
        ).resolves.toEqual({ tenant: "two" });

        expect(
            queryClient.getQueryData(
                createTenantQueryKey(tenantOneUser, keyParts),
            ),
        ).toEqual({ tenant: "one" });
        expect(
            queryClient.getQueryData(
                createTenantQueryKey(tenantTwoUser, keyParts),
            ),
        ).toEqual({ tenant: "two" });
        expect(tenantOneSession.authenticatedFetch).toHaveBeenCalledOnce();
        expect(tenantTwoSession.authenticatedFetch).toHaveBeenCalledOnce();
    });

    test("does not reuse cached data for different users or roles in the same tenant", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const keyParts = ["case-queue", "rollups"];
        const financeAdminSession = createQuerySession(
            tenantOneUser,
            () =>
                new Response(JSON.stringify({ visibleCaseCount: 12 }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );
        const departmentManagerSession = createQuerySession(
            sameTenantDepartmentManagerUser,
            () =>
                new Response(JSON.stringify({ visibleCaseCount: 4 }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );

        await expect(
            queryClient.fetchQuery(
                createExpenseFlowQueryOptions(financeAdminSession, {
                    input: "/v1/case-queue/rollups",
                    keyParts,
                    staleTime: 60_000,
                }),
            ),
        ).resolves.toEqual({ visibleCaseCount: 12 });
        await expect(
            queryClient.fetchQuery(
                createExpenseFlowQueryOptions(departmentManagerSession, {
                    input: "/v1/case-queue/rollups",
                    keyParts,
                    staleTime: 60_000,
                }),
            ),
        ).resolves.toEqual({ visibleCaseCount: 4 });

        expect(
            queryClient.getQueryData(
                createTenantQueryKey(tenantOneUser, keyParts),
            ),
        ).toEqual({ visibleCaseCount: 12 });
        expect(
            queryClient.getQueryData(
                createTenantQueryKey(sameTenantDepartmentManagerUser, keyParts),
            ),
        ).toEqual({ visibleCaseCount: 4 });
        expect(financeAdminSession.authenticatedFetch).toHaveBeenCalledOnce();
        expect(
            departmentManagerSession.authenticatedFetch,
        ).toHaveBeenCalledOnce();
    });

    test("does not enable queries until an authenticated tenant session exists", () => {
        const session = {
            authenticatedFetch: vi.fn(),
            user: null,
        } satisfies Pick<SessionContextValue, "authenticatedFetch" | "user">;

        expect(
            createExpenseFlowQueryOptions(session, {
                input: "/v1/case-queue/rollups",
                keyParts: ["case-queue", "rollups"],
            }),
        ).toMatchObject({
            enabled: false,
            queryKey: [
                "tenant",
                "anonymous",
                "principal",
                "anonymous",
                "roles",
                ["Employee"],
                "case-queue",
                "rollups",
            ],
        });
    });
});

describe("createExpenseFlowQueryClient", () => {
    test("does not retry terminal authentication failures through TanStack Query", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const queryFn = vi.fn(() =>
            Promise.reject(
                new AuthRequestError(401, "Authentication was rejected."),
            ),
        );

        await expect(
            queryClient.fetchQuery({
                queryFn,
                queryKey: createTenantQueryKey(tenantOneUser, ["case-queue"]),
            }),
        ).rejects.toBeInstanceOf(AuthRequestError);

        expect(queryFn).toHaveBeenCalledOnce();
    });

    test("does not retry terminal authorization failures through TanStack Query", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const queryFn = vi.fn(() =>
            Promise.reject(
                new QueryRequestError(403, "Finance Admin role is required."),
            ),
        );

        await expect(
            queryClient.fetchQuery({
                queryFn,
                queryKey: createTenantQueryKey(tenantOneUser, ["case-queue"]),
            }),
        ).rejects.toBeInstanceOf(QueryRequestError);

        expect(queryFn).toHaveBeenCalledOnce();
    });

    test("does not retry terminal validation failures through TanStack Query", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const queryFn = vi.fn(() =>
            Promise.reject(
                new QueryRequestError(422, "Request shape was invalid."),
            ),
        );

        await expect(
            queryClient.fetchQuery({
                queryFn,
                queryKey: createTenantQueryKey(tenantOneUser, ["case-queue"]),
            }),
        ).rejects.toBeInstanceOf(QueryRequestError);

        expect(queryFn).toHaveBeenCalledOnce();
    });

    test("uses the standard retry budget for transient failures through TanStack Query", async () => {
        const queryClient = createExpenseFlowQueryClient();
        const queryFn = vi
            .fn()
            .mockRejectedValueOnce(new Error("Synthetic transient failure."))
            .mockRejectedValueOnce(new Error("Synthetic transient failure."))
            .mockResolvedValue({ ready: true });

        await expect(
            queryClient.fetchQuery({
                queryFn,
                queryKey: createTenantQueryKey(tenantOneUser, ["case-queue"]),
            }),
        ).resolves.toEqual({ ready: true });

        expect(queryFn).toHaveBeenCalledTimes(3);
    });
});

describe("shouldRetryQueryFailure", () => {
    test("does not retry terminal authentication failures", () => {
        expect(
            shouldRetryQueryFailure(
                0,
                new AuthRequestError(401, "Authentication was rejected."),
            ),
        ).toBe(false);
    });

    test("allows the standard retry budget for non-auth failures", () => {
        expect(
            shouldRetryQueryFailure(0, new Error("Synthetic failure.")),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(1, new Error("Synthetic failure.")),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(2, new Error("Synthetic failure.")),
        ).toBe(false);
    });

    test("does not retry terminal 400-range query request failures", () => {
        expect(
            shouldRetryQueryFailure(
                0,
                new QueryRequestError(403, "Forbidden."),
            ),
        ).toBe(false);
        expect(
            shouldRetryQueryFailure(
                0,
                new QueryRequestError(422, "Invalid request."),
            ),
        ).toBe(false);
    });

    test("allows the standard retry budget for retryable 400-range query request failures", () => {
        expect(
            shouldRetryQueryFailure(
                0,
                new QueryRequestError(408, "Request timeout."),
            ),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(
                0,
                new QueryRequestError(429, "Too many requests."),
            ),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(
                2,
                new QueryRequestError(429, "Too many requests."),
            ),
        ).toBe(false);
    });
});
