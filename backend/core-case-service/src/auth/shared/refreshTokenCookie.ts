export const refreshTokenCookieName = "ef_refresh_token";
const refreshTokenCookiePath = "/v1/auth";

export type RefreshTokenCookieConfig = {
    secure: boolean;
};

/**
 * Builds the Set-Cookie header that stores a rotated refresh token.
 */
export function buildRefreshTokenCookie(
    token: string,
    expiresAt: Date,
    config: RefreshTokenCookieConfig,
): string {
    return [
        `${refreshTokenCookieName}=${encodeURIComponent(token)}`,
        `Path=${refreshTokenCookiePath}`,
        `Expires=${expiresAt.toUTCString()}`,
        "HttpOnly",
        `SameSite=${config.secure ? "None" : "Lax"}`,
        ...(config.secure ? ["Secure"] : []),
    ].join("; ");
}

/**
 * Builds the Set-Cookie header that clears a previously issued refresh token.
 */
export function buildClearedRefreshTokenCookie(
    config: RefreshTokenCookieConfig,
): string {
    return [
        `${refreshTokenCookieName}=`,
        `Path=${refreshTokenCookiePath}`,
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "HttpOnly",
        `SameSite=${config.secure ? "None" : "Lax"}`,
        ...(config.secure ? ["Secure"] : []),
    ].join("; ");
}

/**
 * Reads the refresh token cookie value from a request's Cookie header.
 */
export function readRefreshTokenCookie(
    cookieHeader: string | undefined,
): string | undefined {
    if (cookieHeader === undefined) {
        return undefined;
    }

    for (const part of cookieHeader.split(";")) {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }

        const name = part.slice(0, separatorIndex).trim();
        if (name !== refreshTokenCookieName) {
            continue;
        }

        const value = part.slice(separatorIndex + 1).trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return undefined;
        }
    }

    return undefined;
}
