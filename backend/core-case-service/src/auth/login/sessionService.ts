import { z } from "zod";

import type { AccessTokenSigningConfig } from "../../config/authJwtConfig.js";
import { roleValues } from "../../db/schema/index.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import { signAccessToken } from "../shared/accessTokenSigner.js";
import { verifyRefreshToken } from "../shared/refreshTokenSigner.js";
import { hashToken } from "../shared/tokenHash.js";

export const refreshSessionResponseSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.string().min(1),
});

export type RefreshSessionResult = z.infer<
    typeof refreshSessionResponseSchema
>;

export type ActiveRefreshToken = {
    tenantId: string;
    userId: string;
    roles: (typeof roleValues)[number][];
};

export type SessionRepository = {
    findActiveRefreshToken(
        tokenHash: string,
        now: Date,
    ): Promise<ActiveRefreshToken | undefined>;
    revokeRefreshToken(tokenHash: string, now: Date): Promise<void>;
};

export type SessionService = {
    refresh(refreshToken: string): Promise<RefreshSessionResult>;
    logout(refreshToken: string | undefined): Promise<void>;
};

/**
 * Creates the service that restores and revokes browser sessions.
 */
export function createSessionService(
    sessionRepository: SessionRepository,
    authJwtConfig: AccessTokenSigningConfig,
    now: () => Date = () => new Date(),
): SessionService {
    return {
        async refresh(refreshToken: string): Promise<RefreshSessionResult> {
            const currentTime = now();
            const claims = verifyRefreshToken(
                refreshToken,
                authJwtConfig,
                currentTime,
            );
            const activeToken = await sessionRepository.findActiveRefreshToken(
                hashToken(refreshToken),
                currentTime,
            );

            if (
                activeToken === undefined ||
                activeToken.tenantId !== claims.tenantId ||
                activeToken.userId !== claims.userId
            ) {
                throw new UnauthorizedError("A valid refresh token is required.");
            }

            const issuedAccessToken = signAccessToken(
                {
                    tenantId: activeToken.tenantId,
                    userId: activeToken.userId,
                    roles: activeToken.roles,
                },
                authJwtConfig,
                currentTime,
            );

            return refreshSessionResponseSchema.parse({
                tenantId: activeToken.tenantId,
                userId: activeToken.userId,
                accessToken: issuedAccessToken.accessToken,
                accessTokenExpiresAt:
                    issuedAccessToken.accessTokenExpiresAt.toISOString(),
            });
        },

        async logout(refreshToken: string | undefined): Promise<void> {
            if (refreshToken === undefined) {
                return;
            }

            await sessionRepository.revokeRefreshToken(
                hashToken(refreshToken),
                now(),
            );
        },
    };
}
