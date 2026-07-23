import { describe, expect, test, vi } from "vitest";

import {
    AuthRequestError,
    type SessionContextValue,
    type SessionUser,
} from "../auth";
import {
    QueryRequestError,
    createAuthenticatedQueryFn,
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

function createSession(
    response: Response,
): Pick<SessionContextValue, "authenticatedFetch"> {
    return {
        authenticatedFetch: vi.fn(() => Promise.resolve(response)),
    };
}

describe("createTenantQueryKey", () => {
    test("prefixes query keys with the authenticated tenant", () => {
        expect(
            createTenantQueryKey(tenantOneUser, [
                "case-queue",
                "rollups",
                { asOfDate: "2026-07-22" },
            ]),
        ).toEqual([
            "tenant",
            tenantOneUser.tenantId,
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

    test("supports caller-owned response parsing", async () => {
        const session = createSession(new Response(null, { status: 204 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
            parseResponse: (response) => response.status,
        });

        await expect(queryFn()).resolves.toBe(204);
    });

    test("throws a terminal auth error for unrecovered 401 responses", async () => {
        const session = createSession(new Response(null, { status: 401 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).rejects.toBeInstanceOf(AuthRequestError);
    });

    test("throws a query request error for other non-success responses", async () => {
        const session = createSession(new Response(null, { status: 403 }));
        const queryFn = createAuthenticatedQueryFn(session, {
            input: "/v1/case-queue/rollups",
        });

        await expect(queryFn()).rejects.toMatchObject({
            name: "QueryRequestError",
            status: 403,
        } satisfies Partial<QueryRequestError>);
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
});
