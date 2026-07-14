import { describe, expect, test, vi } from "vitest";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import {
    createLoginService,
    type FailedLoginAuditEntry,
    type LoginCredentialRepository,
    type StoredMfaLoginEnrollment,
    type StoredLoginCredential,
} from "./loginService.js";
import type { PasswordHasher } from "./passwordHasher.js";
import type { TotpSecretProtector } from "./totpSecretProtector.js";

const tenantId = "00000000-0000-4000-8000-000000000401";
const userId = "10000000-0000-4000-8000-000000000401";
const password = "synthetic-login-password";
const passwordHash = "$argon2id$v=19$m=8192,t=1,p=1$synthetic$hash";
const validTotpCode = "94287082";
const rfc6238Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const storedCredential: StoredLoginCredential = {
    tenantId,
    userId,
    email: "employee@example.invalid",
    passwordHash,
    passwordHashAlgorithm: "argon2id",
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
        now,
    );
}

void describe("login service", () => {
    void test("issues a refresh token after valid email, password, and TOTP", async () => {
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
            refreshTokenExpiresAt: "1970-01-31T00:00:59.000Z",
        });
        expect(result.refreshToken).toHaveLength(43);
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

        expect(passwordHasher.verifyPasswordMock).not.toHaveBeenCalled();
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

        expect(passwordHasher.verifyPasswordMock).not.toHaveBeenCalled();
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

    void test("issues a refresh token without TOTP when no MFA factor is enrolled", async () => {
        const repository = createRepository(storedCredential, null);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createTestLoginService(repository, passwordHasher);

        const result = await loginService.login({
            tenantId,
            email: "employee@example.invalid",
            password,
        });

        expect(result).toMatchObject({ tenantId, userId });
        expect(repository.failedAuditEntries).toEqual([]);
        expect(repository.createRefreshTokenMock).toHaveBeenCalledOnce();
    });
});
