import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import {
    syntheticRsaPrivateKeyBase64,
    syntheticRsaPublicKeyBase64,
} from "../../testSupport/jwtTestKeys.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import { signAccessToken } from "./accessTokenSigner.js";
import {
    createAccessTokenMiddleware,
    verifyAccessToken,
} from "./accessTokenMiddleware.js";

const issuedAt = new Date("2026-07-15T12:00:00.000Z");
const tenantId = "10000000-0000-4000-8000-000000000100";
const userId = "20000000-0000-4000-8000-000000000001";

function buildConfig() {
    return loadAuthJwtConfig({
        AUTH_JWT_ISSUER: "expenseflow-auth-test",
        AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
        AUTH_JWT_PUBLIC_KEY_BASE64: syntheticRsaPublicKeyBase64,
        AUTH_JWT_KEY_ID: "synthetic-key-v1",
        AUTH_ACCESS_TOKEN_TTL_SECONDS: "600",
    });
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
            buildConfig(),
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
                buildConfig(),
                issuedAt,
            ),
        ).toThrow(UnauthorizedError);
    });

    void test("rejects expired tokens and tokens from another issuer", () => {
        const token = buildAccessToken();

        expect(() =>
            verifyAccessToken(
                token,
                buildConfig(),
                new Date("2026-07-15T12:10:01.000Z"),
            ),
        ).toThrow(UnauthorizedError);
        expect(() =>
            verifyAccessToken(
                token,
                { ...buildConfig(), issuer: "another-issuer" },
                issuedAt,
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

        createAccessTokenMiddleware(buildConfig())(
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

        createAccessTokenMiddleware(buildConfig())(
            request,
            {} as Response,
            next,
        );

        expect(request.auth).toBeUndefined();
        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
});
