import { createHash } from "node:crypto";

import type { RefreshTokenRepository } from "./refreshService.js";

export type LogoutService = {
    logout(rawRefreshToken: string | undefined): Promise<void>;
};

/**
 * Creates a service that revokes a refresh token on sign-out. Always
 * succeeds so a missing, expired, or already-revoked cookie does not block
 * the client from clearing its local session.
 */
export function createLogoutService(
    repository: Pick<RefreshTokenRepository, "findRefreshTokenByHash" | "revokeRefreshToken">,
): LogoutService {
    return {
        async logout(rawRefreshToken): Promise<void> {
            if (rawRefreshToken === undefined || rawRefreshToken.length === 0) {
                return;
            }

            const stored = await repository.findRefreshTokenByHash(
                hashToken(rawRefreshToken),
            );

            if (stored === undefined || stored.revokedAt !== null) {
                return;
            }

            await repository.revokeRefreshToken(stored.id);
        },
    };
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
}
