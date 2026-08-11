import { createHmac } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import {
    buildAuthJwks,
    loadAuthJwtConfig,
} from "../../config/authJwtConfig.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import { signAccessToken } from "./accessTokenSigner.js";
import { signRefreshToken } from "./refreshTokenSigner.js";
import {
    createAccessTokenMiddleware,
    createAccessTokenVerifierConfig,
    verifyAccessToken,
} from "./accessTokenMiddleware.js";

const issuedAt = new Date("2026-07-15T12:00:00.000Z");
const tenantId = "10000000-0000-4000-8000-000000000100";
const userId = "20000000-0000-4000-8000-000000000001";

function buildConfig() {
    return loadAuthJwtConfig({
        AUTH_JWT_ISSUER: "expenseflow-auth-test",
        AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
        AUTH_JWT_KEY_ID: "synthetic-key-v1",
        AUTH_ACCESS_TOKEN_TTL_SECONDS: "600",
    });
}

function buildVerifierConfig() {
    const config = buildConfig();

    return createAccessTokenVerifierConfig(
        config.issuer,
        config.audience,
        buildAuthJwks(config),
    );
}

function buildAccessToken(): string {
    return signAccessToken(
        { tenantId, userId, roles: ["Employee"] },
        buildConfig(),
        issuedAt,
    ).accessToken;
}

void describe("shared access token validation", () => {
    void test("returns trusted identity and tenant claims for a valid token", () => {
        const context = verifyAccessToken(
            buildAccessToken(),
            buildVerifierConfig(),
            new Date("2026-07-15T12:05:00.000Z"),
        );

        expect(context).toStrictEqual({
            userId,
            tenantId,
            roles: ["Employee"],
        });
    });

    void test("rejects a token with a changed payload", () => {
        const token = buildAccessToken();
        const [header, , signature] = token.split(".");
        const changedPayload = Buffer.from(
            JSON.stringify({ tenant_id: tenantId }),
        ).toString("base64url");

        expect(() =>
            verifyAccessToken(
                `${header}.${changedPayload}.${signature}`,
                buildVerifierConfig(),
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects expired tokens and tokens from another issuer", () => {
        const token = buildAccessToken();

        expect(() =>
            verifyAccessToken(
                token,
                buildVerifierConfig(),
                new Date("2026-07-15T12:10:01.000Z"),
            ),
        ).toThrow(UnauthorizedError);
        expect(() =>
            verifyAccessToken(
                token,
                { ...buildVerifierConfig(), issuer: "another-issuer" },
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects a token intended for another audience", () => {
        expect(() =>
            verifyAccessToken(
                buildAccessToken(),
                { ...buildVerifierConfig(), audience: "another-api" },
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects tokens without a matching JWKS kid", () => {
        const token = buildAccessToken();
        const [, encodedPayload, encodedSignature] = token.split(".");
        const missingKidHeader = encodeJson({ alg: "RS256", typ: "JWT" });
        const missingKidToken = `${missingKidHeader}.${encodedPayload}.${encodedSignature}`;

        expect(() =>
            verifyAccessToken(missingKidToken, buildVerifierConfig(), issuedAt),
        ).toThrow(UnauthorizedError);
        expect(() =>
            verifyAccessToken(
                token,
                createAccessTokenVerifierConfig(
                    "expenseflow-auth-test",
                    "expenseflow-http-api",
                    {
                        keys: [
                            { ...buildConfig().publicJwk, kid: "another-key" },
                        ],
                    },
                ),
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects HS256 tokens", () => {
        const header = encodeJson({
            alg: "HS256",
            typ: "JWT",
            kid: "synthetic-key-v1",
        });
        const payload = encodeJson({
            iss: "expenseflow-auth-test",
            aud: "expenseflow-http-api",
            sub: userId,
            tenant_id: tenantId,
            roles: ["Employee"],
            token_use: "access",
            iat: Math.floor(issuedAt.getTime() / 1000),
            exp: Math.floor(issuedAt.getTime() / 1000) + 600,
        });
        const signingInput = `${header}.${payload}`;
        const signature = createHmac("sha256", "synthetic-shared-secret")
            .update(signingInput)
            .digest("base64url");

        expect(() =>
            verifyAccessToken(
                `${signingInput}.${signature}`,
                buildVerifierConfig(),
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects duplicate JWKS key IDs during verifier setup", () => {
        const config = buildConfig();

        expect(() =>
            createAccessTokenVerifierConfig(config.issuer, config.audience, {
                keys: [config.publicJwk, { ...config.publicJwk }],
            }),
        ).toThrow("JWKS key IDs must be unique.");
    });

    void test("bounds malformed token data as unauthorized for direct verification", () => {
        expect(() =>
            verifyAccessToken(
                "not-json.not-json.not-signature",
                buildVerifierConfig(),
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects a signed refresh token as an access token", () => {
        const refreshToken = signRefreshToken(
            {
                tenantId,
                userId,
                roles: ["Employee"],
                jwtId: "30000000-0000-4000-8000-000000000001",
            },
            buildConfig(),
            issuedAt,
            new Date("2026-08-14T12:00:00.000Z"),
        ).refreshToken;

        expect(() =>
            verifyAccessToken(
                refreshToken,
                buildVerifierConfig(),
                new Date("2026-07-15T12:05:00.000Z"),
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("middleware attaches auth context before invoking the handler chain", () => {
        const currentTime = new Date();
        const currentAccessToken = signAccessToken(
            { tenantId, userId, roles: ["Employee"] },
            buildConfig(),
            currentTime,
        ).accessToken;
        const request = {
            headers: { authorization: `Bearer ${currentAccessToken}` },
        } as Request;
        const next = vi.fn() as NextFunction;

        createAccessTokenMiddleware(buildVerifierConfig())(
            request,
            {} as Response,
            next,
        );

        expect(request.auth).toStrictEqual({
            userId,
            tenantId,
            roles: ["Employee"],
        });
        expect(next).toHaveBeenCalledWith();
    });

    void test("middleware rejects a missing bearer token", () => {
        const request = { headers: {} } as Request;
        const next = vi.fn() as NextFunction;

        createAccessTokenMiddleware(buildVerifierConfig())(
            request,
            {} as Response,
            next,
        );

        expect(request.auth).toBeUndefined();
        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
});

function encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
