import {
    createAuthSession,
    loginRequestSchema,
    logoutRequestSchema,
    refreshRequestSchema,
    type AuthSession,
    type LoginRequest,
} from "./authSchemas";

type FetchImplementation = typeof fetch;

export type AuthClient = {
    login: (request: LoginRequest) => Promise<AuthSession>;
    refresh: () => Promise<AuthSession>;
    logout: () => Promise<void>;
};

/** Represents a rejected request to the authentication API. */
export class AuthRequestError extends Error {
    public readonly status: number;

    /** Creates an auth error with its HTTP response status. */
    public constructor(status: number, message: string) {
        super(message);
        this.name = "AuthRequestError";
        this.status = status;
    }
}

/**
 * Creates the HTTP client used by the auth provider.
 */
export function createAuthClient(
    baseUrl: string,
    fetchImplementation: FetchImplementation = fetch,
): AuthClient {
    const authUrl = `${baseUrl.replace(/\/$/, "")}/v1/auth`;

    return {
        async login(request): Promise<AuthSession> {
            const body = loginRequestSchema.parse(request);
            const response = await fetchImplementation(`${authUrl}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                credentials: "include",
            });

            return readSessionResponse(response);
        },

        async refresh(): Promise<AuthSession> {
            const body = refreshRequestSchema.parse({});
            const response = await fetchImplementation(`${authUrl}/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                credentials: "include",
            });

            return readSessionResponse(response);
        },

        async logout(): Promise<void> {
            const body = logoutRequestSchema.parse({});
            const response = await fetchImplementation(`${authUrl}/logout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                credentials: "include",
            });

            if (!response.ok) {
                throw new AuthRequestError(
                    response.status,
                    "Logout was rejected.",
                );
            }
        },
    };
}

async function readSessionResponse(response: Response): Promise<AuthSession> {
    if (!response.ok) {
        throw new AuthRequestError(
            response.status,
            response.status === 401
                ? "Authentication was rejected."
                : "Authentication service request failed.",
        );
    }

    return createAuthSession(await response.json());
}
