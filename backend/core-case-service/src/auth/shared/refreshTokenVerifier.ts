import { createVerify, type KeyObject } from "node:crypto";

import { z } from "zod";

import { UnauthorizedError } from "../../errors/problem-json.js";

const jwtHeaderSchema = z.object({
    alg: z.literal("RS256"),
    typ: z.literal("JWT"),
    kid: z.string().trim().min(1),
});

const refreshTokenClaimsSchema = z.object({
    iss: z.string().min(1),
    sub: z.uuid(),
    tenant_id: z.uuid(),
    token_use: z.literal("refresh"),
    jti: z.string().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

export type RefreshTokenVerifierConfig = {
    issuer: string;
    publicKeysById: Map<string, KeyObject>;
};

export type VerifiedRefreshToken = {
    userId: string;
    tenantId: string;
    jwtId: string;
};

/**
 * Verifies a shared RS256 refresh JWT's signature, issuer, and expiry.
 */
export function verifyRefreshToken(
    token: string,
    config: RefreshTokenVerifierConfig,
    now: Date = new Date(),
): VerifiedRefreshToken {
    try {
        return verifyRefreshTokenUnchecked(token, config, now);
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            throw error;
        }
        throw new UnauthorizedError();
    }
}

function verifyRefreshTokenUnchecked(
    token: string,
    config: RefreshTokenVerifierConfig,
    now: Date,
): VerifiedRefreshToken {
    const segments = token.split(".");
    if (segments.length !== 3) {
        throw new UnauthorizedError();
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    if (
        encodedHeader === undefined ||
        encodedPayload === undefined ||
        encodedSignature === undefined
    ) {
        throw new UnauthorizedError();
    }

    const parsedHeader = jwtHeaderSchema.safeParse(decodeJson(encodedHeader));
    if (!parsedHeader.success) {
        throw new UnauthorizedError();
    }

    const publicKey = config.publicKeysById.get(parsedHeader.data.kid);
    if (publicKey === undefined) {
        throw new UnauthorizedError();
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureIsValid = createVerify("RSA-SHA256")
        .update(signingInput)
        .end()
        .verify(publicKey, Buffer.from(encodedSignature, "base64url"));
    if (!signatureIsValid) {
        throw new UnauthorizedError();
    }

    const parsedClaims = refreshTokenClaimsSchema.safeParse(
        decodeJson(encodedPayload),
    );
    if (!parsedClaims.success) {
        throw new UnauthorizedError();
    }

    const claims = parsedClaims.data;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (
        claims.iss !== config.issuer ||
        claims.exp <= nowSeconds ||
        claims.iat > nowSeconds
    ) {
        throw new UnauthorizedError();
    }

    return {
        userId: claims.sub,
        tenantId: claims.tenant_id,
        jwtId: claims.jti,
    };
}

function decodeJson(segment: string): unknown {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
