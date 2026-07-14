import { describe, expect, test, vi } from "vitest";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import {
    createLoginService,
    type FailedLoginAuditEntry,
    type LoginCredentialRepository,
    type StoredLoginCredential,
} from "./loginService.js";
import type { PasswordHasher } from "./passwordHasher.js";

const tenantId = "00000000-0000-4000-8000-000000000401";
const userId = "10000000-0000-4000-8000-000000000401";
const password = "synthetic-login-password";
const passwordHash = "$argon2id$v=19$m=8192,t=1,p=1$synthetic$hash";
const storedCredential: StoredLoginCredential = {
    tenantId,
    userId,
    email: "employee@example.invalid",
    passwordHash,
    passwordHashAlgorithm: "argon2id",
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
): LoginCredentialRepository & {
    failedAuditEntries: FailedLoginAuditEntry[];
    findByTenantAndEmailMock: ReturnType<typeof vi.fn>;
    recordFailedLoginMock: ReturnType<typeof vi.fn>;
} {
    const failedAuditEntries: FailedLoginAuditEntry[] = [];
    const findByTenantAndEmailMock = vi.fn(() => Promise.resolve(credential));
    const recordFailedLoginMock = vi.fn((entry: FailedLoginAuditEntry) => {
        failedAuditEntries.push(entry);
        return Promise.resolve();
    });

    return {
        failedAuditEntries,
        findByTenantAndEmail: findByTenantAndEmailMock,
        findByTenantAndEmailMock,
        recordFailedLogin: recordFailedLoginMock,
        recordFailedLoginMock,
    };
}

void describe("login service", () => {
    void test("returns an MFA continuation after valid email and password", async () => {
        const repository = createRepository(storedCredential);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createLoginService(repository, passwordHasher);

        const result = await loginService.login({
            tenantId,
            email: "Employee@Example.Invalid",
            password,
        });

        expect(result).toEqual({
            tenantId,
            userId,
            mfaRequired: true,
        });
        expect(repository.findByTenantAndEmailMock).toHaveBeenCalledWith(
            tenantId,
            "employee@example.invalid",
        );
        expect(passwordHasher.verifyPasswordMock).toHaveBeenCalledWith(
            passwordHash,
            password,
        );
        expect(repository.failedAuditEntries).toEqual([]);
    });

    void test("writes audit and returns generic failure for an unknown email", async () => {
        const repository = createRepository(undefined);
        const passwordHasher = createPasswordHasher(true);
        const loginService = createLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "missing@example.invalid",
                password,
            }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(passwordHasher.verifyPasswordMock).not.toHaveBeenCalled();
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
        const loginService = createLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "employee@example.invalid",
                password: "incorrect-synthetic-password",
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
    });

    void test("rejects a stored credential that is not marked as argon2id", async () => {
        const repository = createRepository({
            ...storedCredential,
            passwordHashAlgorithm: "synthetic-legacy-algorithm",
        });
        const passwordHasher = createPasswordHasher(true);
        const loginService = createLoginService(repository, passwordHasher);

        await expect(
            loginService.login({
                tenantId,
                email: "employee@example.invalid",
                password,
            }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(passwordHasher.verifyPasswordMock).not.toHaveBeenCalled();
        expect(repository.failedAuditEntries).toHaveLength(1);
    });
});
