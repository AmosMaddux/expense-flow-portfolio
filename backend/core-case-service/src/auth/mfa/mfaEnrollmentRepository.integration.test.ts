import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
    createDrizzleMfaEnrollmentRepository,
    type MfaEnrollmentDatabase,
} from "./mfaEnrollmentRepository.js";
import { MfaAlreadyEnrolledError } from "../shared/authenticationErrors.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { mfaEnrollment, user } from "../../db/schema/index.js";
import * as schema from "../../db/schema/index.js";

void describe("MFA enrollment repository", () => {
    let pool: Pool;
    let db: MfaEnrollmentDatabase;

    beforeAll(() => {
        pool = new Pool({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        db = drizzle(pool, { schema });
    });

    afterAll(async () => {
        await pool.end();
    });

    void test("creates a tenant-scoped protected TOTP enrollment", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000901";
        const userId = "10000000-0000-4000-8000-000000000901";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "mfa-enrollment@example.invalid",
        });

        const repository = createDrizzleMfaEnrollmentRepository(db);

        await repository.create({
            tenantId,
            userId,
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
            algorithm: "SHA1",
            digits: 6,
            periodSeconds: 30,
        });

        const enrollmentRows = await db
            .select()
            .from(mfaEnrollment)
            .where(eq(mfaEnrollment.tenantId, tenantId));

        expect(enrollmentRows).toHaveLength(1);
        expect(enrollmentRows[0]).toMatchObject({
            tenantId,
            userId,
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
            algorithm: "SHA1",
            digits: 6,
            periodSeconds: 30,
        });
    });

    void test("rejects duplicate enrollment instead of updating the existing factor", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000902";
        const userId = "10000000-0000-4000-8000-000000000902";

        await db.insert(user).values({
            id: userId,
            tenantId,
            email: "mfa-duplicate-enrollment@example.invalid",
        });

        const repository = createDrizzleMfaEnrollmentRepository(db);

        await repository.create({
            tenantId,
            userId,
            secretCiphertext: "synthetic-original-ciphertext",
            secretIv: "synthetic-original-iv",
            secretAuthTag: "synthetic-original-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
            algorithm: "SHA1",
            digits: 6,
            periodSeconds: 30,
        });

        await expect(
            repository.create({
                tenantId,
                userId,
                secretCiphertext: "synthetic-replacement-ciphertext",
                secretIv: "synthetic-replacement-iv",
                secretAuthTag: "synthetic-replacement-auth-tag",
                secretKeyVersion: "synthetic-key-v2",
                algorithm: "SHA1",
                digits: 6,
                periodSeconds: 30,
            }),
        ).rejects.toBeInstanceOf(MfaAlreadyEnrolledError);

        const enrollmentRows = await db
            .select()
            .from(mfaEnrollment)
            .where(eq(mfaEnrollment.tenantId, tenantId));

        expect(enrollmentRows).toHaveLength(1);
        expect(enrollmentRows[0]).toMatchObject({
            tenantId,
            userId,
            secretCiphertext: "synthetic-original-ciphertext",
            secretIv: "synthetic-original-iv",
            secretAuthTag: "synthetic-original-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
        });
    });
});
