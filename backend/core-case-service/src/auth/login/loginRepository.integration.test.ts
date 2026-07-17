import { createPrivateKey } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createPasswordHasher } from "../shared/passwordHasher.js";
import { createLoginService } from "./loginService.js";
import type { TotpSecretProtector } from "../shared/totpSecretProtector.js";
import {
    createDrizzleLoginCredentialRepository,
    type IdentityAuthDatabase,
} from "./loginRepository.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import {
    authenticationAuditEntry,
    credential,
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
const testAuthJwtConfig = {
    issuer: "expenseflow-core-case-service-test",
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
});
