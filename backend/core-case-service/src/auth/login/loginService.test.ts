import { createPrivateKey, createPublicKey, createVerify } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { InvalidCredentialsError } from "../shared/authenticationErrors.js";
import {
    createLoginService,
    type FailedLoginAuditEntry,
    LoginInboundRequestSchema,
    LoginOutboundResponseSchema,
    type LoginCredentialRepository,
    type LoginRequest,
    type LoginResult,
    type StoredMfaLoginEnrollment,
    type StoredLoginCredential,
} from "./loginService.js";
import type { AuthJwtConfig } from "../../config/authJwtConfig.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import type { PasswordHasher } from "../shared/passwordHasher.js";
import type { TotpSecretProtector } from "../shared/totpSecretProtector.js";

const tenantId = "00000000-0000-4000-8000-000000000401";
const userId = "10000000-0000-4000-8000-000000000401";
const password = "synthetic-login-password";
const passwordHash = "$argon2id$v=19$m=8192,t=1,p=1$synthetic$hash";
const validTotpCode = "94287082";
const rfc6238Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const validLoginRequest = {
    tenantId,
    email: "employee@example.invalid",
    password,
    totpCode: validTotpCode,
};
const validLoginResponse = {
    tenantId,
    userId,
    accessToken: "synthetic-access-token",
    accessTokenExpiresAt: "1970-01-01T00:15:59.000Z",
    refreshToken: "synthetic-refresh-token",
    refreshTokenExpiresAt: "1970-01-31T00:00:59.000Z",
};
const syntheticPrivateKeyPem = Buffer.from(
    syntheticRsaPrivateKeyBase64,
    "base64",
).toString("utf8");
const testAuthJwtConfig: AuthJwtConfig = {
    issuer: "expenseflow-core-case-service-test",
    privateKey: createPrivateKey(syntheticPrivateKeyPem),
    keyId: "synthetic-key-v1",
    accessTokenTtlSeconds: 900,
};
const syntheticPublicKeyPem = createPublicKey(syntheticPrivateKeyPem).export({
    type: "spki",
    format: "pem",
});
const storedCredential: StoredLoginCredential = {
    tenantId,
    userId,
    email: "employee@example.invalid",
    passwordHash,
    passwordHashAlgorithm: "argon2id",
    roles: ["Employee"],
};
const storedMfaEnrollment: StoredMfaLoginEnrollment = {
    secretCiphertext: "synthetic-ciphertext",
    secretIv: "synthetic-iv",
    secretAuthTag: "synthetic-auth-tag",
    secretKeyVersion: "synthetic-v1",
    algorithm: "SHA1",
    digits: 8,
    periodSeconds: 30,
};

function createPasswordHasher(passwordMatches: boolean): PasswordHasher & {
    hashPasswordMock: ReturnType<typeof vi.fn>;
    verifyPasswordMock: ReturnType<typeof vi.fn>;
} {
    const hashPasswordMock = vi.fn(() =>
        Promise.resolve("synthetic-password-hash"),
    );
    const verifyPasswordMock = vi.fn(() => Promise.resolve(passwordMatches));

    return {
        hashPassword: hashPasswordMock,
        hashPasswordMock,
        verifyPassword: verifyPasswordMock,
        verifyPasswordMock,
    };
}

function createRepository(
    credential: StoredLoginCredential | undefined,
    mfaEnrollment: StoredMfaLoginEnrollment | null = storedMfaEnrollment,
): LoginCredentialRepository & {
    failedAuditEntries: FailedLoginAuditEntry[];
    refreshTokens: unknown[];
    findByTenantAndEmailMock: ReturnType<typeof vi.fn>;
    findMfaEnrollmentByTenantAndUserMock: ReturnType<typeof vi.fn>;
    createRefreshTokenMock: ReturnType<typeof vi.fn>;
    recordFailedLoginMock: ReturnType<typeof vi.fn>;
} {
    const failedAuditEntries: FailedLoginAuditEntry[] = [];
    const refreshTokens: unknown[] = [];
    const findByTenantAndEmailMock = vi.fn(() => Promise.resolve(credential));
    const findMfaEnrollmentByTenantAndUserMock = vi.fn(() =>
        Promise.resolve(mfaEnrollment ?? undefined),
    );
    const createRefreshTokenMock = vi.fn((token: unknown) => {
        refreshTokens.push(token);
        return Promise.resolve();
    });
    const recordFailedLoginMock = vi.fn((entry: FailedLoginAuditEntry) => {
        failedAuditEntries.push(entry);
        return Promise.resolve();
    });

    return {
        failedAuditEntries,
        refreshTokens,
        findByTenantAndEmail: findByTenantAndEmailMock,
        findByTenantAndEmailMock,
        findMfaEnrollmentByTenantAndUser: findMfaEnrollmentByTenantAndUserMock,
        findMfaEnrollmentByTenantAndUserMock,
        createRefreshToken: createRefreshTokenMock,
        createRefreshTokenMock,
        recordFailedLogin: recordFailedLoginMock,
        recordFailedLoginMock,
    };
}

function createTotpSecretProtector(): TotpSecretProtector {
    return {
        protect: vi.fn(),
        reveal: vi.fn(() => Buffer.from(rfc6238Secret, "utf8")),
    };
}

function createTestLoginService(
    repository: LoginCredentialRepository,
    passwordHasher: PasswordHasher,
    now = () => new Date("1970-01-01T00:00:59.000Z"),
): ReturnType<typeof createLoginService> {
    return createLoginService(
        repository,
        passwordHasher,
        createTotpSecretProtector(),
        testAuthJwtConfig,
        now,
    );
}

void describe("LoginInboundRequestSchema", () => {
    void test("parses the inbound login credential request shape", () => {
        const parsed: LoginRequest =
            LoginInboundRequestSchema.parse(validLoginRequest);

        expect(parsed).toStrictEqual(validLoginRequest);
    });

    void test("rejects login requests with invalid identifiers", () => {
        expect(() =>
            LoginInboundRequestSchema.parse({
                ...validLoginRequest,
                tenantId: "tenant-one",
            }),
        ).toThrow();
    });

    void test("rejects login requests missing a password", () => {
        expect(() =>
            LoginInboundRequestSchema.parse({
                tenantId,
                email: "employee@example.invalid",
            }),
        ).toThrow();
    });

    void test("rejects login requests with invalid email addresses", () => {
        expect(() =>
            LoginInboundRequestSchema.parse({
                ...validLoginRequest,
                email: "not-an-email-address",
            }),
        ).toThrow();
    });
});

void describe("LoginOutboundResponseSchema", () => {
    void test("parses the outbound refresh token response shape", () => {
        const parsed: LoginResult =
            LoginOutboundResponseSchema.parse(validLoginResponse);

        expect(parsed).toStrictEqual(validLoginResponse);
    });

    void test("rejects responses with invalid identifiers", () => {
        expect(() =>
            LoginOutboundResponseSchema.parse({
                ...validLoginResponse,
                userId: "user-one",
            }),
        ).toThrow();
    });

    void test("rejects responses missing a refresh token", () => {
        expect(() =>
            LoginOutboundResponseSchema.parse({
                tenantId,
                userId,
                accessToken: "synthetic-access-token",
                accessTokenExpiresAt: "1970-01-01T00:15:59.000Z",
                refreshTokenExpiresAt: "1970-01-31T00:00:59.000Z",
            }),
        ).toThrow();
    });

    void test("rejects responses missing an access token", () => {
        expect(() =>
            LoginOutboundResponseSchema.parse({
                tenantId,
                userId,
                refreshToken: "synthetic-refresh-token",
                refreshTokenExpiresAt: "1970-01-31T00:00:59.000Z",
            }),
        ).toThrow();
    });
});

void describe("login service", () => {
    void test("issues signed access and refresh JWTs after valid email, password, and TOTP", async () => {
        const repository = createRepository(storedCredential);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(repository, passwordHasher);

        const result = await loginService.login({
            tenantId,
            email: "Employee@Example.Invalid",
            password,
            totpCode: validTotpCode,
        });

        expect(result).toMatchObject({
            tenantId,
            userId,
            accessTokenExpiresAt: "1970-01-01T00:15:59.000Z",
            refreshTokenExpiresAt: "1970-01-31T00:00:59.000Z",
        });
        expect(result.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(result.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(LoginOutboundResponseSchema.parse(result)).toEqual(result);
        const decodedAccessToken = decodeVerifiedJwt(result.accessToken);
        const decodedRefreshToken = decodeVerifiedJwt(result.refreshToken);

        expect(decodedAccessToken.header).toMatchObject({
            alg: "RS256",
            typ: "JWT",
            kid: "synthetic-key-v1",
        });
        expect(decodedAccessToken.payload).toMatchObject({
            iss: testAuthJwtConfig.issuer,
            sub: userId,
            tenant_id: tenantId,
            roles: ["Employee"],
            iat: 59,
            exp: 959,
        });
        expect(decodedRefreshToken.header).toMatchObject({
            alg: "RS256",
            typ: "JWT",
            kid: "synthetic-key-v1",
        });
        expect(decodedRefreshToken.payload).toMatchObject({
            iss: testAuthJwtConfig.issuer,
            sub: userId,
            tenant_id: tenantId,
            roles: ["Employee"],
            token_use: "refresh",
            iat: 59,
            exp: 2592059,
        });
        expect(decodedRefreshToken.payload.jti).toEqual(expect.any(String));
        expect(repository.findByTenantAndEmailMock).toHaveBeenCalledWith(
            tenantId,
            "employee@example.invalid",
        );
        expect(passwordHasher.verifyPasswordMock).toHaveBeenCalledWith(
            passwordHash,
            password,
        );
        expect(
            repository.findMfaEnrollmentByTenantAndUserMock,
        ).toHaveBeenCalledWith(tenantId, userId);
        expect(repository.refreshTokens).toHaveLength(1);
        expect(repository.refreshTokens[0]).toMatchObject({
            tenantId,
            userId,
            expiresAt: new Date("1970-01-31T00:00:59.000Z"),
        });
        expect(repository.refreshTokens[0]).not.toMatchObject({
            tokenHash: result.refreshToken,
        });
        expect(repository.failedAuditEntries).toEqual([]);
    });

    void test("writes audit and returns generic failure for an unknown email", async () => {
        const repository = createRepository(undefined);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "missing@example.invalid",
                password,
                totpCode: validTotpCode,
            }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(passwordHasher.verifyPasswordMock).toHaveBeenCalledWith(
            expect.stringMatching(/^\$argon2id\$/),
            password,
        );
        expect(
            repository.findMfaEnrollmentByTenantAndUserMock,
        ).not.toHaveBeenCalled();
        expect(repository.createRefreshTokenMock).not.toHaveBeenCalled();
        expect(repository.failedAuditEntries).toEqual([
            {
                tenantId,
                userId: null,
                email: "missing@example.invalid",
                action: "login_failed",
            },
        ]);
    });

    void test("writes audit and returns the same generic failure for a bad password", async () => {
        const repository = createRepository(storedCredential);
        const passwordHasher = createPasswordHasher(false);
        const loginService = createTestLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "employee@example.invalid",
                password: "incorrect-synthetic-password",
                totpCode: validTotpCode,
            }),
        ).rejects.toMatchObject({
            name: "InvalidCredentialsError",
            message: "Invalid email or password.",
        });

        expect(repository.failedAuditEntries).toEqual([
            {
                tenantId,
                userId,
                email: "employee@example.invalid",
                action: "login_failed",
            },
        ]);
        expect(
            repository.findMfaEnrollmentByTenantAndUserMock,
        ).not.toHaveBeenCalled();
        expect(repository.createRefreshTokenMock).not.toHaveBeenCalled();
    });

    void test("rejects a stored credential that is not marked as argon2id", async () => {
        const repository = createRepository({
            ...storedCredential,
            passwordHashAlgorithm: "synthetic-legacy-algorithm",
        });
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "employee@example.invalid",
                password,
                totpCode: validTotpCode,
            }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(passwordHasher.verifyPasswordMock).toHaveBeenCalledWith(
            expect.stringMatching(/^\$argon2id\$/),
            password,
        );
        expect(repository.failedAuditEntries).toHaveLength(1);
        expect(repository.createRefreshTokenMock).not.toHaveBeenCalled();
    });

    void test("records MFA audit and rejects invalid or expired TOTP", async () => {
        const repository = createRepository(storedCredential);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(
            repository,
            passwordHasher,
            () => new Date("1970-01-01T00:01:30.000Z"),
        );

        await expect(
            loginService.login({
                tenantId,
                email: "employee@example.invalid",
                password,
                totpCode: validTotpCode,
            }),
        ).rejects.toMatchObject({ name: "InvalidMfaCodeError" });

        expect(repository.failedAuditEntries).toEqual([
            {
                tenantId,
                userId,
                email: "employee@example.invalid",
                action: "mfa_failed",
            },
        ]);
        expect(repository.createRefreshTokenMock).not.toHaveBeenCalled();
    });

    void test("intentionally issues tokens without TOTP while MFA enrollment remains optional", async () => {
        const repository = createRepository(storedCredential, null);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(repository, passwordHasher);

        const result = await loginService.login({
            tenantId,
            email: "employee@example.invalid",
            password,
        });

        expect(result).toMatchObject({ tenantId, userId });
        expect(decodeVerifiedJwt(result.accessToken).payload).toMatchObject({
            roles: ["Employee"],
        });
        expect(repository.failedAuditEntries).toEqual([]);
        expect(repository.createRefreshTokenMock).toHaveBeenCalledOnce();
    });
});

function decodeVerifiedJwt(token: string): {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
} {
    const tokenParts = token.split(".");
    const [encodedHeader, encodedPayload, signature] = tokenParts;

    expect(tokenParts).toHaveLength(3);
    expect(encodedHeader).toBeDefined();
    expect(encodedPayload).toBeDefined();
    expect(signature).toBeDefined();

    const signatureIsValid = createVerify("RSA-SHA256")
        .update(`${encodedHeader}.${encodedPayload}`)
        .end()
        .verify(
            syntheticPublicKeyPem,
            Buffer.from(signature ?? "", "base64url"),
        );

    expect(signatureIsValid).toBe(true);

    return {
        header: JSON.parse(
            Buffer.from(encodedHeader ?? "", "base64url").toString("utf8"),
        ) as Record<string, unknown>,
        payload: JSON.parse(
            Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"),
        ) as Record<string, unknown>,
    };
}
