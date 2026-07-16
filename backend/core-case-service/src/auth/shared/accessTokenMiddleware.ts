import { createVerify } from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import type { AuthJwtConfig } from "../../config/authJwtConfig.js";
import { roleValues, type RoleName } from "../../db/schema/index.js";
import { UnauthorizedError } from "../../errors/problem-json.js";

const jwtHeaderSchema = z.object({
    alg: z.literal("RS256"),
    typ: z.literal("JWT"),
    kid: z.string().min(1).optional(),
});

const accessTokenClaimsSchema = z.object({
    iss: z.string().min(1),
    sub: z.uuid(),
    tenant_id: z.uuid(),
    roles: z.array(z.enum(roleValues)).min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

export type AuthenticatedRequestContext = {
    userId: string;
    tenantId: string;
    roles: RoleName[];
};

declare global {
    namespace Express {
        interface Request {
            auth?: AuthenticatedRequestContext;
        }
    }
}

/**
 * Validates shared RS256 access JWTs and attaches their trusted identity context.
 */
export function createAccessTokenMiddleware(
    config: AuthJwtConfig,
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
    config: AuthJwtConfig,
    now: Date = new Date(),
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

    const header = jwtHeaderSchema.parse(decodeJson(encodedHeader));
    if (config.keyId !== undefined && header.kid !== config.keyId) {
        throw new UnauthorizedError();
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    if (config.publicKey === undefined) {
        throw new UnauthorizedError();
    }

    const signatureIsValid = createVerify("RSA-SHA256")
        .update(signingInput)
        .end()
        .verify(config.publicKey, Buffer.from(encodedSignature, "base64url"));
    if (!signatureIsValid) {
        throw new UnauthorizedError();
    }

    const claims = accessTokenClaimsSchema.parse(decodeJson(encodedPayload));
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
