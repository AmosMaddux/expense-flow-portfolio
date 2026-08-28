import { createHash, randomUUID } from "node:crypto";

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import type { AccessTokenSigningConfig } from "../../config/authJwtConfig.js";
import type { RoleName, UserStatus } from "../../db/schema/index.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import { signAccessToken } from "../shared/accessTokenSigner.js";
import { signRefreshToken } from "../shared/refreshTokenSigner.js";
import {
    verifyRefreshToken,
    type RefreshTokenVerifierConfig,
} from "../shared/refreshTokenVerifier.js";

extendZodWithOpenApi(z);

export const TokenOutboundResponseSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.string().min(1),
});

export type TokenResult = z.infer<typeof TokenOutboundResponseSchema>;

export type StoredRefreshToken = {
    id: string;
    tenantId: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
};

export type ActiveUserRoles = {
    status: UserStatus;
    roles: RoleName[];
};

export type RefreshTokenToCreate = {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
};

export type RefreshTokenRepository = {
    findRefreshTokenByHash(
        tokenHash: string,
    ): Promise<StoredRefreshToken | undefined>;
    findActiveUserRoles(
        tenantId: string,
        userId: string,
    ): Promise<ActiveUserRoles | undefined>;
    revokeRefreshToken(id: string): Promise<void>;
    rotateRefreshToken(input: {
        previousTokenId: string;
        token: RefreshTokenToCreate;
    }): Promise<boolean>;
};

export type RefreshResult = {
    result: TokenResult;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
};

export type RefreshService = {
    refresh(rawRefreshToken: string | undefined): Promise<RefreshResult>;
};

const refreshTokenTtlMillis = 30 * 24 * 60 * 60 * 1000;

/**
 * Creates a service that rotates refresh tokens and re-checks user status
 * and roles from the database on every use, so a deactivated user's session
 * cannot outlive their access token by holding a still-valid refresh token.
 */
export function createRefreshService(
    repository: RefreshTokenRepository,
    verifierConfig: RefreshTokenVerifierConfig,
    authJwtConfig: AccessTokenSigningConfig,
    now: () => Date = () => new Date(),
): RefreshService {
    return {
        async refresh(rawRefreshToken): Promise<RefreshResult> {
            if (rawRefreshToken === undefined || rawRefreshToken.length === 0) {
                throw new UnauthorizedError();
            }

            const currentTime = now();
            const claims = verifyRefreshToken(
                rawRefreshToken,
                verifierConfig,
                currentTime,
            );
            const tokenHash = hashToken(rawRefreshToken);
            // Both lookups depend only on values already available from the
            // verified claims, so they run concurrently rather than paying
            // an extra DB round-trip on every silent token refresh across
            // every active session tenant-wide.
            const [stored, activeUser] = await Promise.all([
                repository.findRefreshTokenByHash(tokenHash),
                repository.findActiveUserRoles(claims.tenantId, claims.userId),
            ]);

            if (
                stored === undefined ||
                stored.tenantId !== claims.tenantId ||
                stored.userId !== claims.userId ||
                stored.revokedAt !== null ||
                stored.expiresAt <= currentTime
            ) {
                throw new UnauthorizedError();
            }

            if (activeUser === undefined || activeUser.status !== "active") {
                await repository.revokeRefreshToken(stored.id);
                throw new UnauthorizedError();
            }

            const issuedAccessToken = signAccessToken(
                {
                    tenantId: claims.tenantId,
                    userId: claims.userId,
                    roles: activeUser.roles,
                },
                authJwtConfig,
                currentTime,
            );
            const refreshTokenExpiresAt = new Date(
                currentTime.getTime() + refreshTokenTtlMillis,
            );
            const issuedRefreshToken = signRefreshToken(
                {
                    tenantId: claims.tenantId,
                    userId: claims.userId,
                    roles: activeUser.roles,
                    jwtId: randomUUID(),
                },
                authJwtConfig,
                currentTime,
                refreshTokenExpiresAt,
            );

            const rotated = await repository.rotateRefreshToken({
                previousTokenId: stored.id,
                token: {
                    tenantId: claims.tenantId,
                    userId: claims.userId,
                    tokenHash: hashToken(issuedRefreshToken.refreshToken),
                    expiresAt: issuedRefreshToken.refreshTokenExpiresAt,
                },
            });

            if (!rotated) {
                throw new UnauthorizedError();
            }

            return {
                result: TokenOutboundResponseSchema.parse({
                    tenantId: claims.tenantId,
                    userId: claims.userId,
                    accessToken: issuedAccessToken.accessToken,
                    accessTokenExpiresAt:
                        issuedAccessToken.accessTokenExpiresAt.toISOString(),
                }),
                refreshToken: issuedRefreshToken.refreshToken,
                refreshTokenExpiresAt: issuedRefreshToken.refreshTokenExpiresAt,
            };
        },
    };
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
}
