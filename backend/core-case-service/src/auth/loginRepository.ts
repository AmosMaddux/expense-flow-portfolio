import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
    authenticationAuditEntry,
    credential,
    mfaEnrollment,
    refreshToken,
    user,
    type NewAuthenticationAuditEntry,
    type NewRefreshToken,
} from "../db/schema/index.js";
import type {
    FailedLoginAuditEntry,
    LoginCredentialRepository,
    StoredMfaLoginEnrollment,
    StoredLoginCredential,
} from "./loginService.js";
import * as schema from "../db/schema/index.js";

export type IdentityAuthDatabase = NodePgDatabase<typeof schema>;

/**
 * Creates a Drizzle-backed repository for login credential checks and audit writes.
 */
export function createDrizzleLoginCredentialRepository(
    db: IdentityAuthDatabase,
): LoginCredentialRepository {
    return {
        async findByTenantAndEmail(
            tenantId: string,
            email: string,
        ): Promise<StoredLoginCredential | undefined> {
            const rows = await db
                .select({
                    tenantId: user.tenantId,
                    userId: user.id,
                    email: user.email,
                    passwordHash: credential.passwordHash,
                    passwordHashAlgorithm: credential.passwordHashAlgorithm,
                })
                .from(user)
                .innerJoin(
                    credential,
                    and(
                        eq(credential.tenantId, user.tenantId),
                        eq(credential.userId, user.id),
                    ),
                )
                .where(
                    and(
                        eq(user.tenantId, tenantId),
                        sql`lower(${user.email}) = ${email}`,
                    ),
                )
                .limit(1);

            return rows[0];
        },
        async findMfaEnrollmentByTenantAndUser(
            tenantId: string,
            userId: string,
        ): Promise<StoredMfaLoginEnrollment | undefined> {
            const rows = await db
                .select({
                    secretCiphertext: mfaEnrollment.secretCiphertext,
                    secretIv: mfaEnrollment.secretIv,
                    secretAuthTag: mfaEnrollment.secretAuthTag,
                    secretKeyVersion: mfaEnrollment.secretKeyVersion,
                    algorithm: mfaEnrollment.algorithm,
                    digits: mfaEnrollment.digits,
                    periodSeconds: mfaEnrollment.periodSeconds,
                })
                .from(mfaEnrollment)
                .where(
                    and(
                        eq(mfaEnrollment.tenantId, tenantId),
                        eq(mfaEnrollment.userId, userId),
                    ),
                )
                .limit(1);
            const enrollment = rows[0];

            if (
                enrollment === undefined ||
                enrollment.algorithm !== "SHA1" ||
                (enrollment.digits !== 6 && enrollment.digits !== 8)
            ) {
                return undefined;
            }

            return {
                ...enrollment,
                algorithm: enrollment.algorithm,
                digits: enrollment.digits,
            };
        },
        async createRefreshToken(token): Promise<void> {
            const tokenRow: NewRefreshToken = {
                tenantId: token.tenantId,
                userId: token.userId,
                tokenHash: token.tokenHash,
                expiresAt: token.expiresAt,
            };

            await db.insert(refreshToken).values(tokenRow);
        },
        async recordFailedLogin(entry: FailedLoginAuditEntry): Promise<void> {
            const auditRow: NewAuthenticationAuditEntry = {
                tenantId: entry.tenantId,
                userId: entry.userId,
                email: entry.email,
                action: entry.action,
            };

            await db.insert(authenticationAuditEntry).values(auditRow);
        },
    };
}
