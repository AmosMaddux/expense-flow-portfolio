import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    useSession,
    type SessionContextValue,
} from "./AuthContext";
import {
    AuthRequestError,
    createAuthClient,
    type AuthClient,
} from "./authClient";
import type { AuthSession } from "./authSchemas";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

let sessionApi: SessionContextValue;

function SessionProbe(): JSX.Element {
    sessionApi = useSession();

    return (
        <div>
            {sessionApi.isRestoring
                ? "restoring"
                : (sessionApi.user?.role ?? "anonymous")}
        </div>
    );
}

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Finance Admin"],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
        ...overrides,
    };
}

function createAuthClientMock(session = createSession()): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(session)),
        refresh: vi.fn(() =>
            Promise.reject(new Error("No synthetic refresh cookie.")),
        ),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createAccessToken(
    claims: Partial<{
        sub: string;
        tenant_id: string;
        roles: string[];
        token_use: string;
    }> = {},
): string {
    const payload = {
        sub: userId,
        tenant_id: tenantId,
        roles: ["Finance Admin"],
        token_use: "access",
        ...claims,
    };
    const encodedPayload = btoa(JSON.stringify(payload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    return `e30.${encodedPayload}.synthetic-signature`;
}

afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
});

describe("AuthProvider", () => {
    test("logs in, exposes tenant identity, and restores the session after a reload", async () => {
        const authClient = createAuthClientMock();
        const firstRender = render(
            <AuthProvider authClient={authClient} now={() => baseTime}>
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        expect(sessionApi.isAuthenticated).toBe(false);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
                totpCode: "123456",
            });
        });

        expect(sessionApi.isAuthenticated).toBe(true);
        expect(sessionApi.user).toEqual({
            id: userId,
            tenantId,
            role: "Finance Admin",
            roles: ["Finance Admin"],
        });
        expect(await sessionApi.getAccessToken()).toBe(
            "synthetic-access-token",
        );
        expect(window.sessionStorage.length).toBe(0);

        firstRender.unmount();
        vi.mocked(authClient.refresh).mockResolvedValueOnce(createSession());
        render(
            <AuthProvider authClient={authClient} now={() => baseTime}>
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        expect(sessionApi.isAuthenticated).toBe(true);
        expect(sessionApi.user?.tenantId).toBe(tenantId);
    });

    test("clears cached query data when a login establishes a new session", async () => {
        const authClient = createAuthClientMock();
        const clearCache = vi.fn(() => Promise.resolve());
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
                totpCode: "123456",
            });
        });

        expect(clearCache).toHaveBeenCalledOnce();
        expect(sessionApi.isAuthenticated).toBe(true);
    });

    test("still establishes a login session when cached query data cannot be cleared, and reports the failure", async () => {
        const authClient = createAuthClientMock();
        const cacheFailure = new Error("Synthetic cache failure.");
        const clearCache = vi.fn(() => Promise.reject(cacheFailure));
        const onLogoutError = vi.fn();
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                onLogoutError={onLogoutError}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();
        vi.mocked(authClient.login).mockClear();
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
                totpCode: "123456",
            });
        });

        expect(authClient.login).toHaveBeenCalledOnce();
        expect(sessionApi.isAuthenticated).toBe(true);
        expect(onLogoutError).toHaveBeenCalledWith(cacheFailure);
    });

    test("clears cached query data before establishing a new login session", async () => {
        const authClient = createAuthClientMock();
        const callOrder: string[] = [];
        const clearCache = vi.fn(() => {
            callOrder.push("clearCache");
            return Promise.resolve();
        });
        vi.mocked(authClient.login).mockImplementation(() => {
            callOrder.push("client.login");
            return Promise.resolve(createSession());
        });
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        callOrder.length = 0;
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
                totpCode: "123456",
            });
        });

        expect(callOrder).toEqual(["clearCache", "client.login"]);
    });

    test("refreshes a nearly expired access token through one central accessor", async () => {
        let currentTime = baseTime;
        const initialSession = createSession({
            accessTokenExpiresAt: new Date(baseTime + 61_000).toISOString(),
        });
        const refreshedSession = createSession({
            accessToken: "synthetic-refreshed-access-token",
            accessTokenExpiresAt: new Date(
                baseTime + 10 * 60_000,
            ).toISOString(),
        });
        const authClient = createAuthClientMock(initialSession);
        render(
            <AuthProvider authClient={authClient} now={() => currentTime}>
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });

        currentTime += 2_000;
        await expect(sessionApi.getAccessToken()).resolves.toBe(
            "synthetic-refreshed-access-token",
        );
        expect(authClient.refresh).toHaveBeenCalledTimes(2);
    });

    test("clears cached query data when refresh changes the authorization scope", async () => {
        let currentTime = baseTime;
        const initialSession = createSession({
            accessTokenExpiresAt: new Date(baseTime + 61_000).toISOString(),
        });
        const refreshedSession = createSession({
            accessToken: "synthetic-manager-access-token",
            accessTokenExpiresAt: new Date(
                baseTime + 10 * 60_000,
            ).toISOString(),
            roles: ["Department Manager"],
        });
        const authClient = createAuthClientMock(initialSession);
        const clearCache = vi.fn(() => Promise.resolve());
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => currentTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockClear();

        currentTime += 2_000;
        await expect(sessionApi.getAccessToken()).resolves.toBe(
            "synthetic-manager-access-token",
        );

        expect(clearCache).toHaveBeenCalledOnce();
        await waitFor(() => {
            expect(sessionApi.user).toMatchObject({
                role: "Department Manager",
                roles: ["Department Manager"],
            });
        });
    });

    test("invalidates the session when authorization-scope refresh cannot clear cache", async () => {
        let currentTime = baseTime;
        const initialSession = createSession({
            accessTokenExpiresAt: new Date(baseTime + 61_000).toISOString(),
        });
        const refreshedSession = createSession({
            accessToken: "synthetic-manager-access-token",
            accessTokenExpiresAt: new Date(
                baseTime + 10 * 60_000,
            ).toISOString(),
            roles: ["Department Manager"],
        });
        const authClient = createAuthClientMock(initialSession);
        const clearCache = vi.fn(() => Promise.resolve());
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => currentTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockRejectedValue(new Error("Synthetic cache failure."));

        currentTime += 2_000;
        await expect(sessionApi.getAccessToken()).resolves.toBeNull();

        await waitFor(() => {
            expect(sessionApi.isAuthenticated).toBe(false);
        });
        expect(clearCache).toHaveBeenCalled();
    });

    test("refreshes and retries once after a 401 response", async () => {
        const refreshedSession = createSession({
            accessToken: "synthetic-refreshed-access-token",
        });
        const authClient = createAuthClientMock();
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        render(
            <AuthProvider
                authClient={authClient}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });

        const response = await sessionApi.authenticatedFetch("/v1/case-queue");

        expect(response.status).toBe(200);
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(authClient.refresh).toHaveBeenCalledTimes(2);
        const initialHeaders = new Headers(
            vi.mocked(fetchImplementation).mock.calls[0]?.[1]?.headers,
        );
        expect(initialHeaders.get("Authorization")).toBe(
            "Bearer synthetic-access-token",
        );
        const retryHeaders = new Headers(
            vi.mocked(fetchImplementation).mock.calls[1]?.[1]?.headers,
        );
        expect(retryHeaders.get("Authorization")).toBe(
            "Bearer synthetic-refreshed-access-token",
        );
    });

    test("does not refresh and retry a 401 response after the original request is aborted", async () => {
        const authClient = createAuthClientMock();
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 401 }));
        const abortController = new AbortController();
        render(
            <AuthProvider
                authClient={authClient}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockClear();
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        abortController.abort();

        await act(async () => {
            await expect(
                sessionApi.authenticatedFetch("/v1/case-queue", {
                    signal: abortController.signal,
                }),
            ).rejects.toMatchObject({ name: "AbortError" });
        });

        expect(authClient.refresh).not.toHaveBeenCalled();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("does not persist an in-flight request refresh after the original request is aborted", async () => {
        let resolveRefresh: ((session: AuthSession) => void) | undefined;
        const authClient = createAuthClientMock();
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 401 }));
        const abortController = new AbortController();
        render(
            <AuthProvider
                authClient={authClient}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }),
        );
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        await waitFor(() => {
            expect(sessionApi.user).toMatchObject({
                role: "Finance Admin",
                roles: ["Finance Admin"],
            });
        });

        const fetchPromise = sessionApi.authenticatedFetch("/v1/case-queue", {
            signal: abortController.signal,
        });
        await waitFor(() => expect(authClient.refresh).toHaveBeenCalledOnce());
        abortController.abort();
        resolveRefresh?.(
            createSession({
                accessToken: "synthetic-manager-access-token",
                roles: ["Department Manager"],
            }),
        );

        await act(async () => {
            await expect(fetchPromise).rejects.toMatchObject({
                name: "AbortError",
            });
        });

        expect(sessionApi.user).toMatchObject({
            role: "Finance Admin",
            roles: ["Finance Admin"],
        });
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });


    test("invalidates the session and cache when a refreshed request still returns 401", async () => {
        const refreshedSession = createSession({
            accessToken: "synthetic-refreshed-access-token",
        });
        const authClient = createAuthClientMock();
        const clearCache = vi.fn(() => Promise.resolve());
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 401 }));
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockClear();

        await act(async () => {
            await expect(
                sessionApi.authenticatedFetch("/v1/case-queue"),
            ).rejects.toBeInstanceOf(AuthRequestError);
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(clearCache).toHaveBeenCalledOnce();
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    test("invalidates the session and cache when request refresh fails after a 401", async () => {
        const authClient = createAuthClientMock();
        const clearCache = vi.fn(() => Promise.resolve());
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 401 }));
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();
        vi.mocked(authClient.refresh).mockRejectedValue(
            new Error("Synthetic refresh rejection."),
        );
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockClear();

        await act(async () => {
            await expect(
                sessionApi.authenticatedFetch("/v1/case-queue"),
            ).rejects.toBeInstanceOf(AuthRequestError);
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(clearCache).toHaveBeenCalledOnce();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("clears session and cached query data even when remote logout fails", async () => {
        const authClient = createAuthClientMock();
        vi.mocked(authClient.logout).mockRejectedValue(
            new Error("Synthetic logout failure."),
        );
        const clearCache = vi.fn(() => Promise.resolve());
        const onLogoutError = vi.fn();
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => baseTime}
                onLogoutError={onLogoutError}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockClear();
        clearCache.mockRejectedValue(new Error("Synthetic cache failure."));

        await act(async () => {
            await expect(sessionApi.logout()).resolves.toBeUndefined();
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(window.sessionStorage.length).toBe(0);
        expect(clearCache).toHaveBeenCalledOnce();
        expect(authClient.logout).toHaveBeenCalledOnce();
        expect(onLogoutError).toHaveBeenCalledTimes(2);
    });

    test("invalidates the session when refresh is rejected", async () => {
        const expiringSession = createSession({
            accessTokenExpiresAt: new Date(baseTime + 30_000).toISOString(),
        });
        const authClient = createAuthClientMock(expiringSession);
        vi.mocked(authClient.refresh).mockRejectedValue(
            new Error("Synthetic refresh rejection."),
        );
        const clearCache = vi.fn(() => Promise.resolve());
        render(
            <AuthProvider
                authClient={authClient}
                clearCache={clearCache}
                now={() => baseTime}
            >
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        clearCache.mockClear();

        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });
        clearCache.mockClear();
        await act(async () => {
            await expect(sessionApi.getAccessToken()).resolves.toBeNull();
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(clearCache).toHaveBeenCalledOnce();
    });

    test("does not restore a session when an in-flight refresh finishes after logout", async () => {
        let resolveRefresh: ((session: AuthSession) => void) | undefined;
        const expiringSession = createSession({
            accessTokenExpiresAt: new Date(baseTime + 30_000).toISOString(),
        });
        const authClient = createAuthClientMock(expiringSession);
        render(
            <AuthProvider authClient={authClient} now={() => baseTime}>
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        vi.mocked(authClient.refresh).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }),
        );
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });

        const tokenPromise = sessionApi.getAccessToken();
        await act(async () => {
            await sessionApi.logout();
            resolveRefresh?.(
                createSession({ accessToken: "synthetic-late-access-token" }),
            );
            await tokenPromise;
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(window.sessionStorage.length).toBe(0);
    });

    test("rejects a restored identity whose tenant differs from its access-token claims", async () => {
        const mismatchedTenantId = "4038c9e3-2223-4fb1-a8f7-3cac30bf4d9a";
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        tenantId,
                        userId,
                        accessToken: createAccessToken({
                            tenant_id: mismatchedTenantId,
                        }),
                        accessTokenExpiresAt: new Date(
                            baseTime + 5 * 60_000,
                        ).toISOString(),
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            ),
        );
        const authClient = createAuthClient("", fetchImplementation);

        render(
            <AuthProvider authClient={authClient} now={() => baseTime}>
                <SessionProbe />
            </AuthProvider>,
        );

        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
        expect(sessionApi.isAuthenticated).toBe(false);
        expect(sessionApi.user).toBeNull();
        expect(fetchImplementation).toHaveBeenCalledWith(
            "/v1/auth/refresh",
            expect.objectContaining({
                body: "{}",
                credentials: "include",
                method: "POST",
            }),
        );
    });
});
