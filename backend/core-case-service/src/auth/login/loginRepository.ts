import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
    authenticationAuditEntry,
    credential,
    mfaEnrollment,
    refreshToken,
    role,
    roleValues,
    user,
    type NewAuthenticationAuditEntry,
    type NewRefreshToken,
    type RoleName,
} from "../../db/schema/index.js";
import type {
    FailedLoginAuditEntry,
    LoginCredentialRepository,
    RefreshTokenToCreate,
    StoredMfaLoginEnrollment,
    StoredLoginCredential,
} from "./loginService.js";
import * as schema from "../../db/schema/index.js";

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
                    role: role.name,
                })
                .from(user)
                .innerJoin(
                    credential,
                    and(
                        eq(credential.tenantId, user.tenantId),
                        eq(credential.userId, user.id),
                    ),
                )
                .innerJoin(
                    role,
                    and(
                        eq(role.tenantId, user.tenantId),
                        eq(role.userId, user.id),
                    ),
                )
                .where(
                    and(
                        eq(user.tenantId, tenantId),
                        sql`lower(${user.email}) = ${email}`,
                    ),
                );

            const row = rows[0];
            const roles = rows.map((result) => result.role).filter(isRoleName);

            if (row === undefined || roles.length === 0) {
                return undefined;
            }

            return {
                tenantId: row.tenantId,
                userId: row.userId,
                email: row.email,
                passwordHash: row.passwordHash,
                passwordHashAlgorithm: row.passwordHashAlgorithm,
                roles: roles.sort(compareRoles),
            };
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
                    lastAcceptedTotpCounter:
                        mfaEnrollment.lastAcceptedTotpCounter,
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
        async recordAcceptedTotpCounter(input): Promise<boolean> {
            const rows = await db
                .update(mfaEnrollment)
                .set({
                    lastAcceptedTotpCounter: input.counter,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(mfaEnrollment.tenantId, input.tenantId),
                        eq(mfaEnrollment.userId, input.userId),
                        or(
                            isNull(mfaEnrollment.lastAcceptedTotpCounter),
                            lt(
                                mfaEnrollment.lastAcceptedTotpCounter,
                                input.counter,
                            ),
                        ),
                    ),
                )
                .returning({ id: mfaEnrollment.id });

            return rows.length === 1;
        },
        async createRefreshToken(token): Promise<void> {
            await db.insert(refreshToken).values(toRefreshTokenRow(token));
        },
        async recordAcceptedTotpCounterAndCreateRefreshToken(
            input,
        ): Promise<boolean> {
            return db.transaction(async (tx) => {
                const rows = await tx
                    .update(mfaEnrollment)
                    .set({
                        lastAcceptedTotpCounter: input.counter,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(mfaEnrollment.tenantId, input.tenantId),
                            eq(mfaEnrollment.userId, input.userId),
                            or(
                                isNull(mfaEnrollment.lastAcceptedTotpCounter),
                                lt(
                                    mfaEnrollment.lastAcceptedTotpCounter,
                                    input.counter,
                                ),
                            ),
                        ),
                    )
                    .returning({ id: mfaEnrollment.id });

                if (rows.length !== 1) {
                    return false;
                }

                await tx.insert(refreshToken).values(toRefreshTokenRow(input));

                return true;
            });
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

function toRefreshTokenRow(token: RefreshTokenToCreate): NewRefreshToken {
    return {
        tenantId: token.tenantId,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
    };
}

function isRoleName(value: string): value is RoleName {
    return (roleValues as readonly string[]).includes(value);
}

function compareRoles(firstRole: RoleName, secondRole: RoleName): number {
    return roleValues.indexOf(firstRole) - roleValues.indexOf(secondRole);
}
