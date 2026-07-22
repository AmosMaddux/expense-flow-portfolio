import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    useSession,
    type SessionContextValue,
} from "./AuthContext";
import { createAuthClient, type AuthClient } from "./authClient";
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
        const retryHeaders = new Headers(
            vi.mocked(fetchImplementation).mock.calls[1]?.[1]?.headers,
        );
        expect(retryHeaders.get("Authorization")).toBe(
            "Bearer synthetic-refreshed-access-token",
        );
    });

    test("clears session and cached query data even when remote logout fails", async () => {
        const authClient = createAuthClientMock();
        vi.mocked(authClient.logout).mockRejectedValue(
            new Error("Synthetic logout failure."),
        );
        const clearCache = vi.fn(() =>
            Promise.reject(new Error("Synthetic cache failure.")),
        );
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
