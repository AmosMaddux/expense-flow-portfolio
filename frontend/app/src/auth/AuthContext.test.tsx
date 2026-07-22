import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    useSession,
    type SessionContextValue,
} from "./AuthContext";
import type { AuthClient } from "./authClient";
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
        refreshToken: "synthetic-refresh-token",
        refreshTokenExpiresAt: new Date(
            baseTime + 24 * 60 * 60_000,
        ).toISOString(),
        ...overrides,
    };
}

function createAuthClientMock(session = createSession()): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(session)),
        refresh: vi.fn(() => Promise.resolve(session)),
        logout: vi.fn(() => Promise.resolve()),
    };
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
        expect(window.sessionStorage.length).toBe(1);

        firstRender.unmount();
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
            refreshToken: "synthetic-rotated-refresh-token",
            accessTokenExpiresAt: new Date(
                baseTime + 10 * 60_000,
            ).toISOString(),
        });
        const authClient = createAuthClientMock(initialSession);
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
        render(
            <AuthProvider authClient={authClient} now={() => currentTime}>
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
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
        expect(authClient.refresh).toHaveBeenCalledOnce();
    });

    test("refreshes and retries once after a 401 response", async () => {
        const refreshedSession = createSession({
            accessToken: "synthetic-refreshed-access-token",
        });
        const authClient = createAuthClientMock();
        vi.mocked(authClient.refresh).mockResolvedValue(refreshedSession);
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
        expect(authClient.refresh).toHaveBeenCalledWith(
            "synthetic-refresh-token",
        );
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
        await act(async () => {
            await sessionApi.login({
                tenantId,
                email: "finance.admin@example.invalid",
                password: "synthetic-password",
            });
        });

        await act(async () => {
            await expect(sessionApi.logout()).rejects.toThrow(
                "Synthetic logout failure.",
            );
        });

        expect(sessionApi.isAuthenticated).toBe(false);
        expect(window.sessionStorage.length).toBe(0);
        expect(clearCache).toHaveBeenCalledOnce();
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
        vi.mocked(authClient.refresh).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }),
        );
        render(
            <AuthProvider authClient={authClient} now={() => baseTime}>
                <SessionProbe />
            </AuthProvider>,
        );
        await waitFor(() => expect(sessionApi.isRestoring).toBe(false));
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
});
