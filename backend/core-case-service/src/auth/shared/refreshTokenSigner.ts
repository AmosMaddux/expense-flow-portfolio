import { createPublicKey, createSign, createVerify } from "node:crypto";
import { z } from "zod";

import type { JwtSigningConfig } from "../../config/authJwtConfig.js";
import { roleValues, type RoleName } from "../../db/schema/index.js";
import { UnauthorizedError } from "../../errors/problem-json.js";

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

const jwtHeaderSchema = z.object({
    alg: z.literal("RS256"),
    typ: z.literal("JWT"),
    kid: z.string().trim().min(1),
});

const refreshTokenClaimsSchema = z.object({
    iss: z.string().min(1),
    sub: z.uuid(),
    tenant_id: z.uuid(),
    roles: z.array(z.enum(roleValues)).min(1),
    token_use: z.literal("refresh"),
    jti: z.string().trim().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

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

/**
 * Returns trusted claims from a valid tenant-scoped refresh JWT.
 */
export function verifyRefreshToken(
    token: string,
    config: JwtSigningConfig,
    now: Date = new Date(),
): RefreshTokenSubject {
    try {
        return verifyRefreshTokenUnchecked(token, config, now);
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            throw error;
        }
        throw new UnauthorizedError("A valid refresh token is required.");
    }
}

function verifyRefreshTokenUnchecked(
    token: string,
    config: JwtSigningConfig,
    now: Date,
): RefreshTokenSubject {
    const segments = token.split(".");
    if (segments.length !== 3) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    if (
        encodedHeader === undefined ||
        encodedPayload === undefined ||
        encodedSignature === undefined
    ) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    const parsedHeader = jwtHeaderSchema.safeParse(decodeJson(encodedHeader));
    if (!parsedHeader.success || parsedHeader.data.kid !== config.keyId) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureIsValid = createVerify("RSA-SHA256")
        .update(signingInput)
        .end()
        .verify(
            createPublicKey(
                config.privateKey.export({ type: "pkcs8", format: "pem" }),
            ),
            Buffer.from(encodedSignature, "base64url"),
        );
    if (!signatureIsValid) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    const parsedClaims = refreshTokenClaimsSchema.safeParse(
        decodeJson(encodedPayload),
    );
    if (!parsedClaims.success) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    const claims = parsedClaims.data;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (claims.iss !== config.issuer || claims.exp <= nowSeconds) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    return {
        tenantId: claims.tenant_id,
        userId: claims.sub,
        roles: claims.roles,
        jwtId: claims.jti,
    };
}

function encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson(segment: string): unknown {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
