import { createPrivateKey } from "node:crypto";
import { type Server } from "node:http";

import express from "express";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import {
    createPostLogin,
    createPostUnsupportedAuthLogin,
} from "./loginController.js";
import {
    createLoginService,
    type LoginCredentialRepository,
    missingCredentialPasswordHash,
    type LoginService,
    type StoredLoginCredential,
} from "./loginService.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import type { AccessTokenSigningConfig } from "../../config/authJwtConfig.js";
import type { PasswordHasher } from "../shared/passwordHasher.js";
import type { TotpSecretProtector } from "../shared/totpSecretProtector.js";
import { MfaRequiredError } from "../shared/authenticationErrors.js";

type TestResponse = Response & {
    statusMock: ReturnType<typeof vi.fn>;
    jsonMock: ReturnType<typeof vi.fn>;
    typeMock: ReturnType<typeof vi.fn>;
    appendMock: ReturnType<typeof vi.fn>;
};

const tenantId = "00000000-0000-4000-8000-000000000603";
const userId = "10000000-0000-4000-8000-000000000603";
const storedCredential: StoredLoginCredential = {
    tenantId,
    userId,
    email: "employee@example.invalid",
    passwordHash: "$argon2id$v=19$m=8192,t=1,p=1$synthetic$hash",
    passwordHashAlgorithm: "argon2id",
    roles: ["Employee"],
    status: "active",
};
const testAuthJwtConfig: AccessTokenSigningConfig = {
    issuer: "expenseflow-core-case-service-test",
    audience: "expenseflow-http-api",
    privateKey: createPrivateKey(
        Buffer.from(syntheticRsaPrivateKeyBase64, "base64").toString("utf8"),
    ),
    keyId: "synthetic-key-v1",
    accessTokenTtlSeconds: 900,
};

function createResponse(): TestResponse {
    const response = {} as TestResponse;
    const statusMock = vi.fn(() => response);
    const jsonMock = vi.fn(() => response);
    const typeMock = vi.fn(() => response);
    const appendMock = vi.fn(() => response);

    response.statusMock = statusMock;
    response.jsonMock = jsonMock;
    response.typeMock = typeMock;
    response.appendMock = appendMock;
    response.status = statusMock;
    response.json = jsonMock;
    response.type = typeMock;
    response.append = appendMock;

    return response;
}

async function withLoginServer<T>(
    loginService: LoginService,
    run: (baseUrl: string) => Promise<T>,
): Promise<T> {
    const app = express();
    app.use(express.json());
    app.post("/auth/login", createPostLogin(loginService, { secure: false }));
    const server = await new Promise<Server>((resolve, reject) => {
        const candidate = app.listen(0, "127.0.0.1");
        candidate.once("listening", () => {
            resolve(candidate);
        });
        candidate.once("error", reject);
    });
    const address = server.address();

    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error(
            "Expected login controller test server to use a TCP port.",
        );
    }

    try {
        return await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await closeServer(server);
    }
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
                return;
            }

            reject(error);
        });
    });
}

void describe("login controller", () => {
    void test("returns refresh token after primary credentials and MFA pass", async () => {
        const loginMock = vi.fn(() =>
            Promise.resolve({
                tenantId: "00000000-0000-4000-8000-000000000601",
                userId: "10000000-0000-4000-8000-000000000601",
                accessToken: "synthetic-access-token",
                accessTokenExpiresAt: "2026-07-15T12:15:00.000Z",
                refreshToken: "synthetic-refresh-token",
                refreshTokenExpiresAt: "2026-08-13T12:00:00.000Z",
            }),
        );
        const loginService: LoginService = {
            login: loginMock,
        };
        const handler = createPostLogin(loginService, { secure: false });
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "00000000-0000-4000-8000-000000000601",
                email: "employee@example.invalid",
                password: "synthetic-login-password",
                totpCode: "123456",
            },
        } as Request;

        await handler(request, response, next);

        expect(loginMock).toHaveBeenCalledWith(request.body);
        expect(response.statusMock).toHaveBeenCalledWith(200);
        expect(response.jsonMock).toHaveBeenCalledWith({
            tenantId: "00000000-0000-4000-8000-000000000601",
            userId: "10000000-0000-4000-8000-000000000601",
            accessToken: "synthetic-access-token",
            accessTokenExpiresAt: "2026-07-15T12:15:00.000Z",
            refreshToken: "synthetic-refresh-token",
            refreshTokenExpiresAt: "2026-08-13T12:00:00.000Z",
        });
        expect(next).not.toHaveBeenCalled();
    });

    void test("returns a machine-readable challenge when MFA is required", async () => {
        const loginService: LoginService = {
            login: vi.fn(() => Promise.reject(new MfaRequiredError())),
        };
        const handler = createPostLogin(loginService, { secure: false });
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId,
                email: "employee@example.invalid",
                password: "synthetic-login-password",
            },
        } as Request;

        await handler(request, response, next);

        expect(response.statusMock).toHaveBeenCalledWith(401);
        expect(response.jsonMock).toHaveBeenCalledWith({
            code: "MFA_REQUIRED",
            message: "MFA code is required.",
        });
        expect(next).not.toHaveBeenCalled();
    });

    void test("returns Problem+JSON for unsupported SSO, SAML, and OIDC login paths", () => {
        const handler = createPostUnsupportedAuthLogin();
        const next = vi.fn() as NextFunction;
        const cases = [
            { originalUrl: "/auth/sso/login", body: undefined },
            {
                originalUrl: "/auth/saml/login",
                body: { tenantId: "not-a-uuid", email: "not-an-email" },
            },
            {
                originalUrl: "/auth/oidc/login",
                body: { extra: "synthetic-extra-field" },
            },
        ];

        for (const { originalUrl, body } of cases) {
            const response = createResponse();

            handler({ body, originalUrl } as Request, response, next);

            expect(response.statusMock).toHaveBeenCalledWith(501);
            expect(response.typeMock).toHaveBeenCalledWith(
                "application/problem+json",
            );
            expect(response.jsonMock).toHaveBeenCalledWith({
                type: "about:blank",
                title: "Not Implemented",
                status: 501,
                detail: "SSO/SAML/OIDC login is not supported in the MVP.",
                instance: originalUrl,
            });
        }

        expect(next).not.toHaveBeenCalled();
    });
    void test("returns the same HTTP response for unknown email and wrong password through the real login path", async () => {
        const findMfaEnrollmentByTenantAndUserMock = vi.fn();
        const createRefreshTokenMock = vi.fn();
        const verifyPasswordMock = vi.fn(() => Promise.resolve(false));
        const repository: LoginCredentialRepository = {
            findByTenantAndEmail: vi.fn((_tenantId: string, email: string) =>
                Promise.resolve(
                    email === "employee@example.invalid"
                        ? storedCredential
                        : undefined,
                ),
            ),
            findMfaEnrollmentByTenantAndUser:
                findMfaEnrollmentByTenantAndUserMock,
            createRefreshToken: createRefreshTokenMock,
            recordAcceptedTotpCounter: vi.fn(),
            recordAcceptedTotpCounterAndCreateRefreshToken: vi.fn(),
            recordFailedLogin: vi.fn(() => Promise.resolve()),
        };
        const passwordHasher: PasswordHasher = {
            hashPassword: vi.fn(),
            verifyPassword: verifyPasswordMock,
        };
        const totpSecretProtector: TotpSecretProtector = {
            protect: vi.fn(),
            reveal: vi.fn(),
        };
        const loginService = createLoginService(
            repository,
            passwordHasher,
            totpSecretProtector,
            testAuthJwtConfig,
        );

        await withLoginServer(loginService, async (baseUrl) => {
            const unknownEmailResponse = await fetch(`${baseUrl}/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    email: "missing@example.invalid",
                    password: "synthetic-login-password",
                    totpCode: "123456",
                }),
            });
            const wrongPasswordResponse = await fetch(`${baseUrl}/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    email: "employee@example.invalid",
                    password: "synthetic-wrong-password",
                    totpCode: "123456",
                }),
            });
            const unknownEmailBody =
                (await unknownEmailResponse.json()) as unknown;
            const wrongPasswordBody =
                (await wrongPasswordResponse.json()) as unknown;

            expect(unknownEmailResponse.status).toBe(401);
            expect(wrongPasswordResponse.status).toBe(401);
            expect(unknownEmailResponse.headers.get("content-type")).toEqual(
                wrongPasswordResponse.headers.get("content-type"),
            );
            expect(unknownEmailBody).toStrictEqual(wrongPasswordBody);
        });

        expect(verifyPasswordMock).toHaveBeenCalledTimes(2);
        expect(verifyPasswordMock).toHaveBeenNthCalledWith(
            1,
            missingCredentialPasswordHash,
            "synthetic-login-password",
        );
        expect(verifyPasswordMock).toHaveBeenNthCalledWith(
            2,
            storedCredential.passwordHash,
            "synthetic-wrong-password",
        );
        expect(findMfaEnrollmentByTenantAndUserMock).not.toHaveBeenCalled();
        expect(createRefreshTokenMock).not.toHaveBeenCalled();
    });
});
