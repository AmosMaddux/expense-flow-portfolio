import { createSign } from "node:crypto";

import type { JwtSigningConfig } from "../../config/authJwtConfig.js";
import type { RoleName } from "../../db/schema/index.js";

export type RefreshTokenSubject = {
    tenantId: string;
    userId: string;
    roles: RoleName[];
    jwtId: string;
};

export type IssuedRefreshToken = {
    refreshToken: string;
    refreshTokenExpiresAt: Date;
};

/**
 * Signs a tenant-scoped RS256 refresh JWT for an authenticated user.
 */
export function signRefreshToken(
    subject: RefreshTokenSubject,
    config: JwtSigningConfig,
    issuedAt: Date,
    expiresAt: Date,
): IssuedRefreshToken {
    const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
    const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: config.keyId,
    };
    const payload = {
        iss: config.issuer,
        sub: subject.userId,
        tenant_id: subject.tenantId,
        roles: subject.roles,
        token_use: "refresh",
        jti: subject.jwtId,
        iat: issuedAtSeconds,
        exp: expiresAtSeconds,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = createSign("RSA-SHA256")
        .update(signingInput)
        .end()
        .sign(config.privateKey)
        .toString("base64url");

    return {
        refreshToken: `${signingInput}.${signature}`,
        refreshTokenExpiresAt: new Date(expiresAtSeconds * 1000),
    };
}

function encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
