import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import type { JsonWebKeySet } from "../../config/authJwtConfig.js";
import { roleValues, type RoleName } from "../../db/schema/index.js";
import { UnauthorizedError } from "../../errors/problem-json.js";

const rsaPublicJwkSchema = z.object({
    kty: z.literal("RSA"),
    kid: z.string().trim().min(1),
    use: z.literal("sig"),
    alg: z.literal("RS256"),
    n: z.string().min(1),
    e: z.string().min(1),
});

const jwksSchema = z.object({
    keys: z.array(rsaPublicJwkSchema).min(1),
});

const jwtHeaderSchema = z.object({
    alg: z.literal("RS256"),
    typ: z.literal("JWT"),
    kid: z.string().trim().min(1),
});

const accessTokenClaimsSchema = z.object({
    iss: z.string().min(1),
    sub: z.uuid(),
    tenant_id: z.uuid(),
    roles: z.array(z.enum(roleValues)).min(1),
    token_use: z.literal("access"),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

export type AccessTokenVerifierConfig = {
    issuer: string;
    publicKeysById: Map<string, KeyObject>;
};

export type AuthenticatedRequestContext = {
    userId: string;
    tenantId: string;
    roles: RoleName[];
};

declare module "express-serve-static-core" {
    interface Request {
        auth?: AuthenticatedRequestContext;
    }
}

/**
 * Builds a verifier configuration from a validated JSON Web Key Set.
 */
export function createAccessTokenVerifierConfig(
    issuer: string,
    jwks: JsonWebKeySet,
): AccessTokenVerifierConfig {
    const parsedJwks = jwksSchema.parse(jwks);
    const publicKeysById = new Map<string, KeyObject>();
    for (const publicJwk of parsedJwks.keys) {
        if (publicKeysById.has(publicJwk.kid)) {
            throw new Error("JWKS key IDs must be unique.");
        }
        publicKeysById.set(
            publicJwk.kid,
            createPublicKey({ key: publicJwk, format: "jwk" }),
        );
    }

    return { issuer, publicKeysById };
}

/**
 * Validates shared RS256 access JWTs and attaches their trusted identity context.
 */
export function createAccessTokenMiddleware(
    config: AccessTokenVerifierConfig,
): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction): void => {
        try {
            const token = readBearerToken(req.headers.authorization);
            req.auth = verifyAccessToken(token, config);
            next();
        } catch {
            next(new UnauthorizedError());
        }
    };
}

/**
 * Returns the trusted user, tenant, and roles from a valid shared access JWT.
 */
export function verifyAccessToken(
    token: string,
    config: AccessTokenVerifierConfig,
    now: Date = new Date(),
): AuthenticatedRequestContext {
    try {
        return verifyAccessTokenUnchecked(token, config, now);
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            throw error;
        }
        throw new UnauthorizedError();
    }
}

function verifyAccessTokenUnchecked(
    token: string,
    config: AccessTokenVerifierConfig,
    now: Date,
): AuthenticatedRequestContext {
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

    const parsedClaims = accessTokenClaimsSchema.safeParse(
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
        roles: claims.roles,
    };
}

function readBearerToken(authorization: string | undefined): string {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
    if (match?.[1] === undefined) {
        throw new UnauthorizedError();
    }

    return match[1];
}

function decodeJson(segment: string): unknown {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
