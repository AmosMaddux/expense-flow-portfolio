import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PropsWithChildren,
} from "react";

import {
    AuthRequestError,
    createAuthClient,
    type AuthClient,
} from "./authClient";
import type { AuthSession, LoginRequest, Role } from "./authSchemas";

const defaultRefreshBufferMs = 60_000;
const noopClearCache = (): void => undefined;
const noopLogoutErrorHandler: (error: unknown) => void = () => undefined;

export type SessionUser = {
    id: string;
    tenantId: string;
    role: Role;
    roles: Role[];
};

export type SessionContextValue = {
    user: SessionUser | null;
    isAuthenticated: boolean;
    isRestoring: boolean;
    login(request: LoginRequest): Promise<void>;
    logout(): Promise<void>;
    getAccessToken(): Promise<string | null>;
    authenticatedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response>;
};

export type AuthProviderProps = PropsWithChildren<{
    apiBaseUrl?: string;
    authClient?: AuthClient;
    clearCache?: () => void | Promise<void>;
    onLogoutError?: (error: unknown) => void;
    fetchImplementation?: typeof fetch;
    refreshBufferMs?: number;
    now?: () => number;
}>;

const SessionContext = createContext<SessionContextValue | undefined>(
    undefined,
);

/**
 * Owns the authenticated browser session and its token lifecycle.
 */
export function AuthProvider({
    children,
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "",
    authClient,
    clearCache = noopClearCache,
    onLogoutError = noopLogoutErrorHandler,
    fetchImplementation = fetch,
    refreshBufferMs = defaultRefreshBufferMs,
    now = Date.now,
}: AuthProviderProps): JSX.Element {
    const client = useMemo(
        () => authClient ?? createAuthClient(apiBaseUrl, fetchImplementation),
        [apiBaseUrl, authClient, fetchImplementation],
    );
    const [session, setSessionState] = useState<AuthSession | null>(null);
    const [isRestoring, setIsRestoring] = useState(true);
    const sessionRef = useRef<AuthSession | null>(null);
    const sessionVersionRef = useRef(0);
    const refreshPromiseRef = useRef<Promise<AuthSession | null> | null>(null);
    const hasRestoredRef = useRef(false);

    const persistSession = useCallback(
        (nextSession: AuthSession | null): void => {
            sessionVersionRef.current += 1;
            sessionRef.current = nextSession;
            setSessionState(nextSession);
        },
        [],
    );

    const invalidateSession = useCallback(async (): Promise<void> => {
        persistSession(null);
        await Promise.allSettled([Promise.resolve().then(clearCache)]);
    }, [clearCache, persistSession]);

    const refreshSession = useCallback(
        async (signal?: AbortSignal | null): Promise<AuthSession | null> => {
            throwIfRequestAborted(signal);
            if (refreshPromiseRef.current !== null) {
                return resolveRefreshForSignal(
                    refreshPromiseRef.current,
                    signal,
                );
            }

            const refreshVersion = sessionVersionRef.current;
            const refreshPromise = refreshAndPersistSession(
                client,
                clearCache,
                onLogoutError,
                persistSession,
                refreshVersion,
                sessionVersionRef,
                sessionRef,
                null,
            ).catch(async (error: unknown) => {
                if (isAbortError(error)) {
                    return null;
                }

                if (sessionVersionRef.current === refreshVersion) {
                    await invalidateSession();
                }

                return null;
            });

            refreshPromiseRef.current = refreshPromise.finally(() => {
                refreshPromiseRef.current = null;
            });

            return resolveRefreshForSignal(refreshPromiseRef.current, signal);
        },
        [clearCache, client, invalidateSession, onLogoutError, persistSession],
    );

    useEffect(() => {
        if (hasRestoredRef.current) {
            return;
        }

        hasRestoredRef.current = true;
        void refreshSession().finally(() => {
            setIsRestoring(false);
        });
    }, [refreshSession]);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        const refreshIn = Math.max(
            0,
            Date.parse(session.accessTokenExpiresAt) - now() - refreshBufferMs,
        );
        const timeout = window.setTimeout(() => {
            void refreshSession();
        }, refreshIn);

        return () => window.clearTimeout(timeout);
    }, [now, refreshBufferMs, refreshSession, session]);

    const login = useCallback(
        async (request: LoginRequest): Promise<void> => {
            // A failed cache clear must not block login, but it must not be
            // silently lost either: it's reported the same way logout
            // reports a failed cache clear or revocation call.
            await Promise.resolve()
                .then(clearCache)
                .catch((error: unknown) => {
                    reportLogoutError(onLogoutError, error);
                });
            const nextSession = await client.login(request);
            persistSession(nextSession);
        },
        [clearCache, client, onLogoutError, persistSession],
    );

    const logout = useCallback(async (): Promise<void> => {
        // Local identity and tenant-scoped query data must disappear immediately,
        // even when the revocation endpoint is unavailable.
        persistSession(null);
        const results = await Promise.allSettled([
            Promise.resolve().then(clearCache),
            Promise.resolve().then(() => client.logout()),
        ]);

        for (const result of results) {
            if (result.status === "rejected") {
                reportLogoutError(onLogoutError, result.reason as unknown);
            }
        }
    }, [clearCache, client, onLogoutError, persistSession]);

    const getAccessToken = useCallback(async (): Promise<string | null> => {
        const currentSession = sessionRef.current;
        if (currentSession === null) {
            return null;
        }

        if (
            Date.parse(currentSession.accessTokenExpiresAt) - now() <=
            refreshBufferMs
        ) {
            const refreshedSession = await refreshSession();
            if (refreshedSession !== null) {
                return refreshedSession.accessToken;
            }

            // The refresh may have resolved to null because a concurrent
            // refresh already advanced sessionRef past this attempt's
            // version, not because the session is actually gone.
            return sessionRef.current?.accessToken ?? null;
        }

        return currentSession.accessToken;
    }, [now, refreshBufferMs, refreshSession]);

    const authenticatedFetch = useCallback(
        async (
            input: RequestInfo | URL,
            init: RequestInit = {},
        ): Promise<Response> => {
            const accessToken = await getAccessToken();
            if (accessToken === null) {
                throw new AuthRequestError(
                    401,
                    "An authenticated session is required.",
                );
            }

            const sendRequest = async (token: string): Promise<Response> => {
                const headers = new Headers(init.headers);
                headers.set("Authorization", `Bearer ${token}`);
                return fetchImplementation(input, { ...init, headers });
            };

            const response = await sendRequest(accessToken);
            if (response.status !== 401) {
                return response;
            }

            throwIfRequestAborted(init.signal);
            const refreshedSession = await refreshSession(init.signal);
            throwIfRequestAborted(init.signal);
            if (refreshedSession === null) {
                throw new AuthRequestError(401, "Authentication was rejected.");
            }

            const refreshVersionBeforeRetry = sessionVersionRef.current;
            const retryResponse = await sendRequest(
                refreshedSession.accessToken,
            );
            if (retryResponse.status === 401) {
                // Only invalidate if no other refresh has advanced the
                // session since this retry's token was sent; otherwise a
                // newer, valid session would be logged out from under the
                // user because of a stale retried token.
                if (sessionVersionRef.current === refreshVersionBeforeRetry) {
                    await invalidateSession();
                }

                throw new AuthRequestError(401, "Authentication was rejected.");
            }

            return retryResponse;
        },
        [
            fetchImplementation,
            getAccessToken,
            invalidateSession,
            refreshSession,
        ],
    );

    const user = useMemo<SessionUser | null>(() => {
        const role = session?.roles[0];
        if (session === null || role === undefined) {
            return null;
        }

        return {
            id: session.userId,
            tenantId: session.tenantId,
            role,
            roles: session.roles,
        };
    }, [session]);
    const value = useMemo<SessionContextValue>(
        () => ({
            user,
            isAuthenticated: session !== null,
            isRestoring,
            login,
            logout,
            getAccessToken,
            authenticatedFetch,
        }),
        [
            authenticatedFetch,
            getAccessToken,
            isRestoring,
            login,
            logout,
            session,
            user,
        ],
    );

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
}

async function refreshAndPersistSession(
    client: AuthClient,
    clearCache: () => void | Promise<void>,
    onLogoutError: (error: unknown) => void,
    persistSession: (nextSession: AuthSession | null) => void,
    refreshVersion: number,
    sessionVersionRef: { current: number },
    sessionRef: { current: AuthSession | null },
    signal: AbortSignal | null | undefined,
): Promise<AuthSession | null> {
    throwIfRequestAborted(signal);
    const refreshedSession = await client.refresh();
    throwIfRequestAborted(signal);

    if (sessionVersionRef.current !== refreshVersion) {
        return null;
    }

    const currentSession = sessionRef.current;
    if (
        currentSession !== null &&
        !hasSameAuthorizationScope(currentSession, refreshedSession)
    ) {
        // A failed cache clear must not block persisting the refreshed
        // session, but it must not be silently lost either: report it the
        // same way login/logout report a failed cache clear.
        await Promise.resolve()
            .then(clearCache)
            .catch((error: unknown) => {
                reportLogoutError(onLogoutError, error);
            });
        throwIfRequestAborted(signal);
    }

    persistSession(refreshedSession);
    return refreshedSession;
}

function hasSameAuthorizationScope(
    currentSession: AuthSession,
    nextSession: AuthSession,
): boolean {
    return (
        currentSession.tenantId === nextSession.tenantId &&
        currentSession.userId === nextSession.userId &&
        normalizeRoles(currentSession.roles).join("\n") ===
            normalizeRoles(nextSession.roles).join("\n")
    );
}

function normalizeRoles(roles: readonly Role[]): Role[] {
    return [...roles].sort();
}

function throwIfRequestAborted(signal: AbortSignal | null | undefined): void {
    if (signal?.aborted !== true) {
        return;
    }

    throw getAbortError(signal);
}

function getAbortError(signal: AbortSignal): Error | DOMException {
    return signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}

function resolveRefreshForSignal(
    refreshPromise: Promise<AuthSession | null>,
    signal: AbortSignal | null | undefined,
): Promise<AuthSession | null> {
    if (signal === null || signal === undefined) {
        return refreshPromise;
    }

    if (signal.aborted) {
        return Promise.reject(getAbortError(signal));
    }

    return new Promise<AuthSession | null>((resolve, reject) => {
        const abortRefreshWait = () => {
            reject(getAbortError(signal));
        };

        signal.addEventListener("abort", abortRefreshWait, { once: true });
        refreshPromise.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", abortRefreshWait);
        });
    });
}

function isAbortError(error: unknown): boolean {
    return (
        error instanceof DOMException ||
        (typeof error === "object" && error !== null && "name" in error)
    ) && (error as { name: unknown }).name === "AbortError";
}

function reportLogoutError(
    onLogoutError: (error: unknown) => void,
    error: unknown,
): void {
    try {
        onLogoutError(error);
    } catch {
        // Reporting failures must not change auth-session state transitions.
    }
}

/**
 * Returns the single application session API.
 */
export function useSession(): SessionContextValue {
    const context = useContext(SessionContext);

    if (context === undefined) {
        throw new Error("useSession must be used within an AuthProvider.");
    }

    return context;
}
