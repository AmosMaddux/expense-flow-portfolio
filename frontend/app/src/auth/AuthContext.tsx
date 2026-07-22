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

import { createAuthClient, type AuthClient } from "./authClient";
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

    const refreshSession =
        useCallback(async (): Promise<AuthSession | null> => {
            if (refreshPromiseRef.current !== null) {
                return refreshPromiseRef.current;
            }

            const refreshVersion = sessionVersionRef.current;

            const refreshPromise = client
                .refresh()
                .then((refreshedSession) => {
                    if (sessionVersionRef.current !== refreshVersion) {
                        return null;
                    }

                    persistSession(refreshedSession);
                    return refreshedSession;
                })
                .catch(async () => {
                    if (sessionVersionRef.current === refreshVersion) {
                        await invalidateSession();
                    }

                    return null;
                })
                .finally(() => {
                    refreshPromiseRef.current = null;
                });
            refreshPromiseRef.current = refreshPromise;

            return refreshPromise;
        }, [client, invalidateSession, persistSession]);

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
            const nextSession = await client.login(request);
            persistSession(nextSession);
        },
        [client, persistSession],
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
                try {
                    onLogoutError(result.reason as unknown);
                } catch {
                    // Reporting failures must not make the logout contract reject.
                }
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
            return (await refreshSession())?.accessToken ?? null;
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
                throw new Error("An authenticated session is required.");
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

            const refreshedSession = await refreshSession();
            if (refreshedSession === null) {
                return response;
            }

            return sendRequest(refreshedSession.accessToken);
        },
        [fetchImplementation, getAccessToken, refreshSession],
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
