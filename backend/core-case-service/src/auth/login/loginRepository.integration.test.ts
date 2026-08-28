import { createPrivateKey } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createPasswordHasher } from "../shared/passwordHasher.js";
import { createLoginService } from "./loginService.js";
import {
    createTotpSecretProtector,
    type TotpSecretProtector,
} from "../shared/totpSecretProtector.js";
import {
    createDrizzleLoginCredentialRepository,
    type IdentityAuthDatabase,
} from "./loginRepository.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import {
    authenticationAuditEntry,
    credential,
    mfaEnrollment,
    refreshToken,
    role,
    user,
} from "../../db/schema/index.js";
import * as schema from "../../db/schema/index.js";

const testHashConfig = {
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
    hashLength: 32,
};
const unusedTotpSecretProtector: TotpSecretProtector = {
    protect: () => {
        throw new Error("Not needed for failed password integration tests.");
    },
    reveal: () => {
        throw new Error("Not needed for failed password integration tests.");
    },
};
const rfc6238Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const validTotpCode = "94287082";
const invalidTotpCode = "00000000";
const loginNow = () => new Date("1970-01-01T00:00:59.000Z");
const realTotpSecretProtector = createTotpSecretProtector(() => ({
    key: Buffer.alloc(32, 2),
    keyVersion: "synthetic-v1",
}));
const testAuthJwtConfig = {
    issuer: "expenseflow-core-case-service-test",
    audience: "expenseflow-http-api",
    privateKey: createPrivateKey(
        Buffer.from(syntheticRsaPrivateKeyBase64, "base64").toString("utf8"),
    ),
    keyId: "synthetic-key-v1",
    accessTokenTtlSeconds: 900,
};

void describe("login repository", () => {
    let pool: Pool;
    let db: IdentityAuthDatabase;

    beforeAll(() => {
        pool = new Pool({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        db = drizzle(pool, { schema });
    });

    afterAll(async () => {
        await pool.end();
    });

    void test("finds credentials by tenant and case-insensitive email", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000501";
        const userId = "10000000-0000-4000-8000-000000000501";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const passwordHash = await passwordHasher.hashPassword(
            "synthetic-login-password",
        );

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "CaseLookup@example.invalid",
        });
        await db.insert(credential).values({
            tenantId,
            userId,
            passwordHash,
            passwordHashAlgorithm: "argon2id",
        });
        await db.insert(role).values({
            tenantId,
            userId,
            name: "Employee",
        });

        const repository = createDrizzleLoginCredentialRepository(db);

        await expect(
            repository.findByTenantAndEmail(
                tenantId,
                "caselookup@example.invalid",
            ),
        ).resolves.toMatchObject({
            tenantId,
            userId,
            email: "CaseLookup@example.invalid",
            passwordHash,
            passwordHashAlgorithm: "argon2id",
            roles: ["Employee"],
        });
    });

    void test("finds the role for the requested tenant when emails overlap", async () => {
        const firstTenantId = "00000000-0000-4000-8000-000000000503";
        const secondTenantId = "00000000-0000-4000-8000-000000000504";
        const firstUserId = "10000000-0000-4000-8000-000000000503";
        const secondUserId = "10000000-0000-4000-8000-000000000504";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const firstPasswordHash = await passwordHasher.hashPassword(
            "synthetic-first-password",
        );
        const secondPasswordHash = await passwordHasher.hashPassword(
            "synthetic-second-password",
        );

        await db.insert(user).values([
            {
                id: firstUserId,
                tenantId: firstTenantId,
                email: "tenant-overlap@example.invalid",
            },
            {
                id: secondUserId,
                tenantId: secondTenantId,
                email: "tenant-overlap@example.invalid",
            },
        ]);
        await db.insert(credential).values([
            {
                tenantId: firstTenantId,
                userId: firstUserId,
                passwordHash: firstPasswordHash,
                passwordHashAlgorithm: "argon2id",
            },
            {
                tenantId: secondTenantId,
                userId: secondUserId,
                passwordHash: secondPasswordHash,
                passwordHashAlgorithm: "argon2id",
            },
        ]);
        await db.insert(role).values([
            {
                tenantId: firstTenantId,
                userId: firstUserId,
                name: "Employee",
            },
            {
                tenantId: secondTenantId,
                userId: secondUserId,
                name: "Finance Admin",
            },
        ]);

        const repository = createDrizzleLoginCredentialRepository(db);

        await expect(
            repository.findByTenantAndEmail(
                secondTenantId,
                "tenant-overlap@example.invalid",
            ),
        ).resolves.toMatchObject({
            tenantId: secondTenantId,
            userId: secondUserId,
            passwordHash: secondPasswordHash,
            roles: ["Finance Admin"],
        });
    });

    void test("returns all assigned roles in deterministic vocabulary order", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000505";
        const userId = "10000000-0000-4000-8000-000000000505";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const passwordHash = await passwordHasher.hashPassword(
            "synthetic-multi-role-password",
        );

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "multi-role@example.invalid",
        });
        await db.insert(credential).values({
            tenantId,
            userId,
            passwordHash,
            passwordHashAlgorithm: "argon2id",
        });
        await db.insert(role).values([
            {
                tenantId,
                userId,
                name: "Employee",
            },
            {
                tenantId,
                userId,
                name: "Finance Admin",
            },
            {
                tenantId,
                userId,
                name: "Department Manager",
            },
        ]);

        const repository = createDrizzleLoginCredentialRepository(db);

        await expect(
            repository.findByTenantAndEmail(
                tenantId,
                "multi-role@example.invalid",
            ),
        ).resolves.toMatchObject({
            tenantId,
            userId,
            roles: ["Finance Admin", "Department Manager", "Employee"],
        });
    });

    void test("records each accepted TOTP counter only once", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000506";
        const userId = "10000000-0000-4000-8000-000000000506";
        const repository = createDrizzleLoginCredentialRepository(db);

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "totp-replay@example.invalid",
        });
        await db.insert(mfaEnrollment).values({
            tenantId,
            userId,
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-v1",
            algorithm: "SHA1",
            digits: 6,
            periodSeconds: 30,
        });

        await expect(
            repository.recordAcceptedTotpCounter({
                tenantId,
                userId,
                counter: 10,
            }),
        ).resolves.toBe(true);
        await expect(
            repository.recordAcceptedTotpCounter({
                tenantId,
                userId,
                counter: 10,
            }),
        ).resolves.toBe(false);
        await expect(
            repository.recordAcceptedTotpCounter({
                tenantId,
                userId,
                counter: 11,
            }),
        ).resolves.toBe(true);
        await expect(
            repository.recordAcceptedTotpCounter({
                tenantId: "00000000-0000-4000-8000-000000000509",
                userId,
                counter: 12,
            }),
        ).resolves.toBe(false);

        const enrollmentRows = await db
            .select()
            .from(mfaEnrollment)
            .where(eq(mfaEnrollment.tenantId, tenantId));

        expect(enrollmentRows[0]?.lastAcceptedTotpCounter).toBe(11);
    });

    void test("rolls back accepted TOTP counter when refresh token persistence fails", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000511";
        const userId = "10000000-0000-4000-8000-000000000511";
        const repository = createDrizzleLoginCredentialRepository(db);
        const duplicateTokenHash = "synthetic-duplicate-refresh-token-hash";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "totp-rollback@example.invalid",
        });
        await db.insert(mfaEnrollment).values({
            tenantId,
            userId,
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-v1",
            algorithm: "SHA1",
            digits: 6,
            periodSeconds: 30,
        });
        await db.insert(refreshToken).values({
            tenantId,
            userId,
            tokenHash: duplicateTokenHash,
            expiresAt: new Date("1970-01-31T00:00:59.000Z"),
        });

        await expect(
            repository.recordAcceptedTotpCounterAndCreateRefreshToken({
                tenantId,
                userId,
                counter: 20,
                tokenHash: duplicateTokenHash,
                expiresAt: new Date("1970-01-31T00:00:59.000Z"),
            }),
        ).rejects.toThrow();

        const enrollmentRows = await db
            .select()
            .from(mfaEnrollment)
            .where(eq(mfaEnrollment.tenantId, tenantId));

        expect(enrollmentRows[0]?.lastAcceptedTotpCounter).toBeNull();
    });
    void test("writes MFA audit entries and preserves refresh tokens for wrong and replayed TOTP", async () => {
        const passwordHasher = createPasswordHasher(testHashConfig);
        const loginService = createLoginService(
            createDrizzleLoginCredentialRepository(db),
            passwordHasher,
            realTotpSecretProtector,
            testAuthJwtConfig,
            loginNow,
        );
        const wrongTotpTenantId = "00000000-0000-4000-8000-000000000507";
        const wrongTotpUserId = "10000000-0000-4000-8000-000000000507";
        const replayTenantId = "00000000-0000-4000-8000-000000000508";
        const replayUserId = "10000000-0000-4000-8000-000000000508";

        await seedLoginSubject({
            db,
            tenantId: wrongTotpTenantId,
            userId: wrongTotpUserId,
            email: "wrong-totp@example.invalid",
            password: "synthetic-correct-password",
            passwordHasher,
        });
        await seedLoginSubject({
            db,
            tenantId: replayTenantId,
            userId: replayUserId,
            email: "replayed-totp@example.invalid",
            password: "synthetic-correct-password",
            passwordHasher,
        });

        await expect(
            loginService.login({
                tenantId: wrongTotpTenantId,
                email: "wrong-totp@example.invalid",
                password: "synthetic-correct-password",
                totpCode: invalidTotpCode,
            }),
        ).rejects.toMatchObject({ name: "InvalidMfaCodeError" });
        await expect(
            loginService.login({
                tenantId: replayTenantId,
                email: "replayed-totp@example.invalid",
                password: "synthetic-correct-password",
                totpCode: validTotpCode,
            }),
        ).resolves.toMatchObject({
            tenantId: replayTenantId,
            userId: replayUserId,
        });
        await expect(
            loginService.login({
                tenantId: replayTenantId,
                email: "replayed-totp@example.invalid",
                password: "synthetic-correct-password",
                totpCode: validTotpCode,
            }),
        ).rejects.toMatchObject({ name: "InvalidMfaCodeError" });

        await expect(auditRowsForTenant(wrongTotpTenantId)).resolves.toEqual([
            expect.objectContaining({
                tenantId: wrongTotpTenantId,
                userId: wrongTotpUserId,
                action: "mfa_failed",
                email: "wrong-totp@example.invalid",
            }),
        ]);
        await expect(auditRowsForTenant(replayTenantId)).resolves.toEqual([
            expect.objectContaining({
                tenantId: replayTenantId,
                userId: replayUserId,
                action: "mfa_failed",
                email: "replayed-totp@example.invalid",
            }),
        ]);
        await expect(
            refreshTokenRowsForTenant(wrongTotpTenantId),
        ).resolves.toHaveLength(0);
        await expect(
            refreshTokenRowsForTenant(replayTenantId),
        ).resolves.toHaveLength(1);

        async function auditRowsForTenant(tenantId: string) {
            return db
                .select()
                .from(authenticationAuditEntry)
                .where(eq(authenticationAuditEntry.tenantId, tenantId));
        }

        async function refreshTokenRowsForTenant(tenantId: string) {
            return db
                .select()
                .from(refreshToken)
                .where(eq(refreshToken.tenantId, tenantId));
        }
    });
    void test("accepts only one concurrent login attempt for the same TOTP", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000510";
        const userId = "10000000-0000-4000-8000-000000000510";
        const email = "concurrent-totp@example.invalid";
        const password = "synthetic-correct-password";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const loginService = createLoginService(
            createDrizzleLoginCredentialRepository(db),
            passwordHasher,
            realTotpSecretProtector,
            testAuthJwtConfig,
            loginNow,
        );

        await seedLoginSubject({
            db,
            tenantId,
            userId,
            email,
            password,
            passwordHasher,
        });

        const loginRequest = {
            tenantId,
            email,
            password,
            totpCode: validTotpCode,
        };
        const loginResults = await Promise.allSettled([
            loginService.login(loginRequest),
            loginService.login(loginRequest),
        ]);
        const fulfilledResults = loginResults.filter(
            (result) => result.status === "fulfilled",
        );
        const rejectedResults = loginResults.filter(
            (result) => result.status === "rejected",
        );
        const tokenRows = await db
            .select()
            .from(refreshToken)
            .where(eq(refreshToken.tenantId, tenantId));
        const auditRows = await db
            .select()
            .from(authenticationAuditEntry)
            .where(eq(authenticationAuditEntry.tenantId, tenantId));

        expect(fulfilledResults).toHaveLength(1);
        expect(fulfilledResults[0]).toMatchObject({
            value: { tenantId, userId },
        });
        expect(rejectedResults).toHaveLength(1);
        expect(rejectedResults[0]).toMatchObject({
            reason: { name: "InvalidMfaCodeError" },
        });
        expect(tokenRows).toHaveLength(1);
        expect(auditRows).toEqual([
            expect.objectContaining({
                tenantId,
                userId,
                action: "mfa_failed",
                email,
            }),
        ]);
    });
    void test("writes an audit entry after failed login", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000502";
        const userId = "10000000-0000-4000-8000-000000000502";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const loginService = createLoginService(
            createDrizzleLoginCredentialRepository(db),
            passwordHasher,
            unusedTotpSecretProtector,
            testAuthJwtConfig,
        );
        const passwordHash = await passwordHasher.hashPassword(
            "synthetic-correct-password",
        );

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "audit-login@example.invalid",
        });
        await db.insert(credential).values({
            tenantId,
            userId,
            passwordHash,
            passwordHashAlgorithm: "argon2id",
        });
        await db.insert(role).values({
            tenantId,
            userId,
            name: "Department Manager",
        });

        await expect(
            loginService.login({
                tenantId,
                email: "audit-login@example.invalid",
                password: "synthetic-wrong-password",
                totpCode: "123456",
            }),
        ).rejects.toMatchObject({
            name: "InvalidCredentialsError",
            message: "Invalid email or password.",
        });

        const auditRows = await db
            .select()
            .from(authenticationAuditEntry)
            .where(eq(authenticationAuditEntry.tenantId, tenantId));

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            tenantId,
            userId,
            action: "login_failed",
            email: "audit-login@example.invalid",
        });
    });

    void test("findActiveUserRoles reflects the current status and roles from the database", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000512";
        const userId = "10000000-0000-4000-8000-000000000512";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "refresh-active@example.invalid",
        });
        await db.insert(role).values([
            { tenantId, userId, name: "Department Manager" },
        ]);

        const repository = createDrizzleLoginCredentialRepository(db);

        await expect(
            repository.findActiveUserRoles(tenantId, userId),
        ).resolves.toEqual({
            status: "active",
            roles: ["Department Manager"],
        });

        await db
            .update(user)
            .set({ status: "deactivated" })
            .where(eq(user.id, userId));

        await expect(
            repository.findActiveUserRoles(tenantId, userId),
        ).resolves.toEqual({
            status: "deactivated",
            roles: ["Department Manager"],
        });
    });

    void test("rotateRefreshToken revokes the previous token exactly once and inserts the new one", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000513";
        const userId = "10000000-0000-4000-8000-000000000513";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "refresh-rotate@example.invalid",
        });
        const [inserted] = await db
            .insert(refreshToken)
            .values({
                tenantId,
                userId,
                tokenHash: "synthetic-previous-token-hash",
                expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            })
            .returning({ id: refreshToken.id });
        const previousTokenId = inserted?.id;
        if (previousTokenId === undefined) {
            throw new Error("Expected a previous refresh token id.");
        }

        const repository = createDrizzleLoginCredentialRepository(db);

        const [firstRotation, secondRotation] = await Promise.all([
            repository.rotateRefreshToken({
                previousTokenId,
                token: {
                    tenantId,
                    userId,
                    tokenHash: "synthetic-rotated-token-hash-a",
                    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
                },
            }),
            repository.rotateRefreshToken({
                previousTokenId,
                token: {
                    tenantId,
                    userId,
                    tokenHash: "synthetic-rotated-token-hash-b",
                    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
                },
            }),
        ]);

        expect([firstRotation, secondRotation].filter(Boolean)).toHaveLength(
            1,
        );

        const previousRow = await db
            .select({ revokedAt: refreshToken.revokedAt })
            .from(refreshToken)
            .where(eq(refreshToken.id, previousTokenId));
        expect(previousRow[0]?.revokedAt).not.toBeNull();

        const rotatedRows = await db
            .select({ tokenHash: refreshToken.tokenHash })
            .from(refreshToken)
            .where(eq(refreshToken.userId, userId));
        expect(rotatedRows).toHaveLength(2);
    });

    void test("revokeRefreshToken marks a stored token revoked so it can no longer be used", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000514";
        const userId = "10000000-0000-4000-8000-000000000514";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "refresh-revoke@example.invalid",
        });
        const [inserted] = await db
            .insert(refreshToken)
            .values({
                tenantId,
                userId,
                tokenHash: "synthetic-revocable-token-hash",
                expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            })
            .returning({ id: refreshToken.id });
        const tokenId = inserted?.id;
        if (tokenId === undefined) {
            throw new Error("Expected an inserted refresh token id.");
        }

        const repository = createDrizzleLoginCredentialRepository(db);
        await repository.revokeRefreshToken(tokenId);

        const revoked = await repository.findRefreshTokenByHash(
            "synthetic-revocable-token-hash",
        );
        expect(revoked?.id).toBe(tokenId);
        expect(revoked?.revokedAt).toBeInstanceOf(Date);
    });
});

type SeedLoginSubjectInput = {
    db: IdentityAuthDatabase;
    tenantId: string;
    userId: string;
    email: string;
    password: string;
    passwordHasher: ReturnType<typeof createPasswordHasher>;
};

async function seedLoginSubject(input: SeedLoginSubjectInput): Promise<void> {
    const passwordHash = await input.passwordHasher.hashPassword(
        input.password,
    );
    const protectedSecret = realTotpSecretProtector.protect(
        Buffer.from(rfc6238Secret, "utf8"),
    );

    await input.db.insert(user).values({
        id: input.userId,
        tenantId: input.tenantId,
        email: input.email,
    });
    await input.db.insert(credential).values({
        tenantId: input.tenantId,
        userId: input.userId,
        passwordHash,
        passwordHashAlgorithm: "argon2id",
    });
    await input.db.insert(role).values({
        tenantId: input.tenantId,
        userId: input.userId,
        name: "Employee",
    });
    await input.db.insert(mfaEnrollment).values({
        tenantId: input.tenantId,
        userId: input.userId,
        ...protectedSecret,
        algorithm: "SHA1",
        digits: 8,
        periodSeconds: 30,
    });
}
