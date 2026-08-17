import { fileURLToPath } from "node:url";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import { createMfaEnrollmentService } from "../auth/mfa/mfaEnrollmentService.js";
import { createPasswordHasher } from "../auth/shared/passwordHasher.js";
import {
    createTotpSecretProtector,
    type ProtectedTotpSecret,
} from "../auth/shared/totpSecretProtector.js";
import { loadPasswordHashConfig } from "../config/passwordHashConfig.js";
import {
    credential,
    mfaEnrollment,
    refreshToken,
    role,
    user,
} from "../db/schema/identityAuth.js";
import {
    auditEntry,
    caseComment,
    expenseReport,
    glCodingResult,
    lineItem,
    stageTransition,
} from "../db/schema/expenseReport.js";
import * as schema from "../db/schema/index.js";
import {
    getLocalAuthAccount,
    getLocalAuthAccountTenantId,
    getLocalAuthAccounts,
    localAuthEnvironmentSchema,
    resolveLocalAuthAccountName,
    type LocalAuthAccount,
    type LocalAuthEnvironment,
} from "./localAuthConfig.js";
import {
    generateLocalTotpCode,
    getLocalTotpSecondsRemaining,
} from "./localTotp.js";

const localAuthCommandSchema = z.enum(["seed", "code"]);
const totpPeriodSeconds = 30;
const minimumUsefulCodeLifetimeSeconds = 10;

export type LocalAuthDatabase = NodePgDatabase<typeof schema>;

const legacyEmployeeSubmissionIds = [
    "7a000000-0000-4000-8000-000000000001",
    "7b000000-0000-4000-8000-000000000001",
    "7c000000-0000-4000-8000-000000000001",
    "7d000000-0000-4000-8000-000000000001",
];

async function seedLocalAuthAccount(
    database: LocalAuthDatabase,
    environment: LocalAuthEnvironment,
    account: LocalAuthAccount,
): Promise<void> {
    const tenantId = getLocalAuthAccountTenantId(environment, account);
    const passwordHash = await createPasswordHasher(
        loadPasswordHashConfig(),
    ).hashPassword(environment.EXPENSEFLOW_DEV_PASSWORD);
    const secretProtector = createTotpSecretProtector();

    await database.transaction(async (transaction) => {
        const existingUsers = await transaction
            .select({ id: user.id, email: user.email })
            .from(user)
            .where(
                and(
                    eq(user.tenantId, tenantId),
                    or(
                        eq(user.id, account.userId),
                        eq(user.email, account.email),
                    ),
                ),
            )
            .limit(1);
        const existingUser = existingUsers[0];
        const userId = existingUser?.id ?? account.userId;

        if (existingUser === undefined) {
            await transaction.insert(user).values({
                id: userId,
                tenantId,
                email: account.email,
            });
        } else if (existingUser.email !== account.email) {
            await transaction
                .update(user)
                .set({ email: account.email, updatedAt: new Date() })
                .where(and(eq(user.tenantId, tenantId), eq(user.id, userId)));
        }

        await transaction
            .insert(credential)
            .values({
                tenantId,
                userId,
                passwordHash,
                passwordHashAlgorithm: "argon2id",
            })
            .onConflictDoUpdate({
                target: [credential.tenantId, credential.userId],
                set: {
                    passwordHash,
                    passwordHashAlgorithm: "argon2id",
                    updatedAt: new Date(),
                },
            });

        await transaction
            .delete(role)
            .where(and(eq(role.tenantId, tenantId), eq(role.userId, userId)));
        await transaction.insert(role).values({
            tenantId,
            userId,
            name: account.role,
        });

        // Rotating the factor makes reseeding deterministic after local configuration changes.
        await transaction
            .delete(refreshToken)
            .where(
                and(
                    eq(refreshToken.tenantId, tenantId),
                    eq(refreshToken.userId, userId),
                ),
            );
        await transaction
            .delete(mfaEnrollment)
            .where(
                and(
                    eq(mfaEnrollment.tenantId, tenantId),
                    eq(mfaEnrollment.userId, userId),
                ),
            );

        await createMfaEnrollmentService(
            {
                async create(enrollment): Promise<void> {
                    await transaction.insert(mfaEnrollment).values({
                        tenantId: enrollment.tenantId,
                        userId: enrollment.userId,
                        secretCiphertext: enrollment.secretCiphertext,
                        secretIv: enrollment.secretIv,
                        secretAuthTag: enrollment.secretAuthTag,
                        secretKeyVersion: enrollment.secretKeyVersion,
                        algorithm: enrollment.algorithm,
                        digits: enrollment.digits,
                        periodSeconds: enrollment.periodSeconds,
                    });
                },
            },
            secretProtector,
        ).enroll({
            tenantId,
            userId,
            email: account.email,
        });
    });
}

/**
 * Seeds every fixed synthetic identity used for local role testing.
 */
export async function seedLocalAuthAccounts(
    database: LocalAuthDatabase,
    environment: LocalAuthEnvironment,
): Promise<void> {
    await removeLegacyEmployeeSubmissionFixtures(database);

    for (const account of getLocalAuthAccounts()) {
        await seedLocalAuthAccount(database, environment, account);
    }
}

async function removeLegacyEmployeeSubmissionFixtures(
    database: LocalAuthDatabase,
): Promise<void> {
    await database.transaction(async (transaction) => {
        // The loopback-only seed must bypass append-only triggers to remove its obsolete fixed fixtures.
        await transaction.execute(
            sql`set local session_replication_role = replica`,
        );
        await transaction
            .delete(glCodingResult)
            .where(
                inArray(
                    glCodingResult.expenseReportId,
                    legacyEmployeeSubmissionIds,
                ),
            );
        await transaction
            .delete(caseComment)
            .where(
                inArray(
                    caseComment.expenseReportId,
                    legacyEmployeeSubmissionIds,
                ),
            );
        await transaction
            .delete(stageTransition)
            .where(
                inArray(
                    stageTransition.expenseReportId,
                    legacyEmployeeSubmissionIds,
                ),
            );
        await transaction
            .delete(auditEntry)
            .where(
                inArray(
                    auditEntry.expenseReportId,
                    legacyEmployeeSubmissionIds,
                ),
            );
        await transaction
            .delete(lineItem)
            .where(
                inArray(lineItem.expenseReportId, legacyEmployeeSubmissionIds),
            );
        await transaction
            .delete(expenseReport)
            .where(inArray(expenseReport.id, legacyEmployeeSubmissionIds));
    });
}

async function readCurrentLocalTotpCode(
    database: LocalAuthDatabase,
    environment: LocalAuthEnvironment,
    account: LocalAuthAccount,
): Promise<string> {
    const tenantId = getLocalAuthAccountTenantId(environment, account);
    const enrollments = await database
        .select({
            secretCiphertext: mfaEnrollment.secretCiphertext,
            secretIv: mfaEnrollment.secretIv,
            secretAuthTag: mfaEnrollment.secretAuthTag,
            secretKeyVersion: mfaEnrollment.secretKeyVersion,
            digits: mfaEnrollment.digits,
            periodSeconds: mfaEnrollment.periodSeconds,
        })
        .from(mfaEnrollment)
        .innerJoin(
            user,
            and(
                eq(user.tenantId, mfaEnrollment.tenantId),
                eq(user.id, mfaEnrollment.userId),
            ),
        )
        .where(and(eq(user.tenantId, tenantId), eq(user.email, account.email)))
        .limit(1);
    const enrollment = enrollments[0];

    if (
        enrollment === undefined ||
        (enrollment.digits !== 6 && enrollment.digits !== 8)
    ) {
        throw new Error("Synthetic local MFA enrollment was not found.");
    }

    const protectedSecret: ProtectedTotpSecret = {
        secretCiphertext: enrollment.secretCiphertext,
        secretIv: enrollment.secretIv,
        secretAuthTag: enrollment.secretAuthTag,
        secretKeyVersion: enrollment.secretKeyVersion,
    };
    const encodedSecret = createTotpSecretProtector()
        .reveal(protectedSecret)
        .toString("utf8");

    return generateLocalTotpCode(
        encodedSecret,
        enrollment.digits,
        enrollment.periodSeconds,
    );
}

async function waitForUsefulTotpInterval(): Promise<void> {
    const secondsRemaining = getLocalTotpSecondsRemaining(totpPeriodSeconds);

    if (secondsRemaining >= minimumUsefulCodeLifetimeSeconds) {
        return;
    }

    // Avoid presenting a code that is likely to expire while it is being entered.
    await new Promise<void>((resolve) => {
        setTimeout(resolve, (secondsRemaining + 1) * 1000);
    });
}

function formatLocalAuthError(error: unknown): string {
    if (!(error instanceof Error)) {
        return "Unknown local auth error.";
    }

    return error.message.replaceAll(
        /postgres(?:ql)?:\/\/[^@\s]+@/gi,
        "postgres://<redacted>@",
    );
}

async function main(): Promise<void> {
    const environment = localAuthEnvironmentSchema.parse(process.env);
    const command = localAuthCommandSchema.parse(process.argv[2] ?? "seed");
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        if (command === "code") {
            const accountName = resolveLocalAuthAccountName(
                process.argv[3] ?? "employee-1",
            );
            await waitForUsefulTotpInterval();
            const currentCode = await readCurrentLocalTotpCode(
                database,
                environment,
                getLocalAuthAccount(accountName),
            );
            process.stdout.write(`${currentCode}\n`);
            return;
        }

        await seedLocalAuthAccounts(database, environment);

        process.stdout.write(
            [
                "Synthetic local ExpenseFlow accounts are ready.",
                ...getLocalAuthAccounts().map(
                    (account) =>
                        `${account.name}: ${account.email} (${account.role}, ${account.tenant} tenant)`,
                ),
                "Generate MFA with: npm run dev:auth:code -- <account>",
                "",
            ].join("\n"),
        );
    } finally {
        await pool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().catch((error: unknown) => {
        process.stderr.write(
            [
                "Unable to manage synthetic local auth accounts.",
                formatLocalAuthError(error),
                "Use only a loopback database and check local auth configuration.",
                "",
            ].join("\n"),
        );
        process.exitCode = 1;
    });
}
