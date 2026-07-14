import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
    authenticationAuditEntry,
    credential,
    user,
    type NewAuthenticationAuditEntry,
} from "../db/schema/index.js";
import type {
    FailedLoginAuditEntry,
    LoginCredentialRepository,
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
