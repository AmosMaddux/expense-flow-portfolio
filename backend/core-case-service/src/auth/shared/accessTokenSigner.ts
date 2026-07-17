import { createSign } from "node:crypto";

import type { AuthJwtConfig } from "../../config/authJwtConfig.js";
import type { RoleName } from "../../db/schema/index.js";

export type AccessTokenSubject = {
    tenantId: string;
    userId: string;
    roles: RoleName[];
};

export type IssuedAccessToken = {
    accessToken: string;
    accessTokenExpiresAt: Date;
};

/**
 * Signs a tenant-scoped RS256 access JWT for an authenticated user.
 */
export function signAccessToken(
    subject: AccessTokenSubject,
    config: AuthJwtConfig,
    issuedAt: Date,
): IssuedAccessToken {
    const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + config.accessTokenTtlSeconds;
    const header = {
        alg: "RS256",
        typ: "JWT",
        ...(config.keyId === undefined ? {} : { kid: config.keyId }),
    };
    const payload = {
        iss: config.issuer,
        sub: subject.userId,
        tenant_id: subject.tenantId,
        roles: subject.roles,
        token_use: "access",
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
        accessToken: `${signingInput}.${signature}`,
        accessTokenExpiresAt: new Date(expiresAtSeconds * 1000),
    };
}

function encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
