import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createPasswordHasher } from "./passwordHasher.js";
import { createLoginService } from "./loginService.js";
import {
    createDrizzleLoginCredentialRepository,
    type IdentityAuthDatabase,
} from "./loginRepository.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import {
    authenticationAuditEntry,
    credential,
    user,
} from "../db/schema/index.js";
import * as schema from "../db/schema/index.js";

const testHashConfig = {
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
    hashLength: 32,
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
        });
    });

    void test("writes an audit entry after failed login", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000502";
        const userId = "10000000-0000-4000-8000-000000000502";
        const passwordHasher = createPasswordHasher(testHashConfig);
        const loginService = createLoginService(
            createDrizzleLoginCredentialRepository(db),
            passwordHasher,
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

        await expect(
            loginService.login({
                tenantId,
                email: "audit-login@example.invalid",
                password: "synthetic-wrong-password",
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
