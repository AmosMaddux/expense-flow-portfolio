import { and, eq } from "drizzle-orm";
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
    expenseReport,
    lineItem,
    stageTransition,
} from "../db/schema/expenseReport.js";
import * as schema from "../db/schema/index.js";
import {
    getLocalAuthAccount,
    getLocalAuthAccounts,
    localAuthAccountNameSchema,
    localAuthEnvironmentSchema,
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

type LocalAuthDatabase = NodePgDatabase<typeof schema>;
type LocalAuthTransaction = Parameters<
    Parameters<LocalAuthDatabase["transaction"]>[0]
>[0];

const overdueSubmissionId = "7a000000-0000-4000-8000-000000000001";
const overdueSubmissionDueDate = "2026-06-20";

async function seedLocalAuthAccount(
    database: LocalAuthDatabase,
    environment: LocalAuthEnvironment,
    account: LocalAuthAccount,
): Promise<void> {
    const passwordHash = await createPasswordHasher(
        loadPasswordHashConfig(),
    ).hashPassword(environment.EXPENSEFLOW_DEV_PASSWORD);
    const secretProtector = createTotpSecretProtector();

    await database.transaction(async (transaction) => {
        const existingUsers = await transaction
            .select({ id: user.id })
            .from(user)
            .where(
                and(
                    eq(user.tenantId, environment.VITE_TENANT_ID),
                    eq(user.email, account.email),
                ),
            )
            .limit(1);
        const userId = existingUsers[0]?.id ?? account.userId;

        if (existingUsers.length === 0) {
            await transaction.insert(user).values({
                id: userId,
                tenantId: environment.VITE_TENANT_ID,
                email: account.email,
            });
        }

        await transaction
            .insert(credential)
            .values({
                tenantId: environment.VITE_TENANT_ID,
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
            .where(
                and(
                    eq(role.tenantId, environment.VITE_TENANT_ID),
                    eq(role.userId, userId),
                ),
            );
        await transaction.insert(role).values({
            tenantId: environment.VITE_TENANT_ID,
            userId,
            name: account.role,
        });

        // Rotating the factor makes reseeding deterministic after local configuration changes.
        await transaction
            .delete(refreshToken)
            .where(
                and(
                    eq(refreshToken.tenantId, environment.VITE_TENANT_ID),
                    eq(refreshToken.userId, userId),
                ),
            );
        await transaction
            .delete(mfaEnrollment)
            .where(
                and(
                    eq(mfaEnrollment.tenantId, environment.VITE_TENANT_ID),
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
            tenantId: environment.VITE_TENANT_ID,
            userId,
            email: account.email,
        });

        if (account.role === "Employee") {
            await seedOverdueEmployeeSubmission(
                transaction,
                environment.VITE_TENANT_ID,
                userId,
            );
        }
    });
}

async function seedOverdueEmployeeSubmission(
    transaction: LocalAuthTransaction,
    tenantId: string,
    ownerId: string,
): Promise<void> {
    const seededAt = new Date("2026-06-20T12:00:00.000Z");

    await transaction
        .insert(expenseReport)
        .values({
            id: overdueSubmissionId,
            tenantId,
            owner: ownerId,
            dueDate: overdueSubmissionDueDate,
            priority: "Normal",
            currentStage: "Manager Approval",
            createdAt: seededAt,
            updatedAt: seededAt,
        })
        .onConflictDoUpdate({
            target: expenseReport.id,
            set: {
                tenantId,
                owner: ownerId,
                dueDate: overdueSubmissionDueDate,
                priority: "Normal",
                currentStage: "Manager Approval",
                onHold: false,
                holdReason: null,
                updatedAt: seededAt,
            },
        });

    await transaction
        .insert(auditEntry)
        .values([
            {
                id: "7a000000-0000-4000-8000-000000000002",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actorId: ownerId,
                action: "report_created",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Drafted",
                createdAt: seededAt,
            },
            {
                id: "7a000000-0000-4000-8000-000000000003",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actorId: ownerId,
                action: "transition_approved",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Submitted",
                createdAt: new Date("2026-06-21T12:00:00.000Z"),
            },
            {
                id: "7a000000-0000-4000-8000-000000000004",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actorId: ownerId,
                action: "transition_approved",
                stageBeforeAction: "Submitted",
                stageAfterProposedAction: "Manager Approval",
                createdAt: new Date("2026-06-22T12:00:00.000Z"),
            },
        ])
        .onConflictDoNothing();

    await transaction
        .insert(stageTransition)
        .values([
            {
                id: "7a000000-0000-4000-8000-000000000005",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actor: ownerId,
                fromStage: "Drafted",
                toStage: "Drafted",
                reason: "report_created",
                occurredAt: seededAt,
            },
            {
                id: "7a000000-0000-4000-8000-000000000006",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actor: ownerId,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: "Synthetic local workflow progression.",
                occurredAt: new Date("2026-06-21T12:00:00.000Z"),
            },
            {
                id: "7a000000-0000-4000-8000-000000000007",
                tenantId,
                expenseReportId: overdueSubmissionId,
                actor: ownerId,
                fromStage: "Submitted",
                toStage: "Manager Approval",
                reason: "Synthetic local workflow progression.",
                occurredAt: new Date("2026-06-22T12:00:00.000Z"),
            },
        ])
        .onConflictDoNothing();

    await transaction
        .insert(lineItem)
        .values({
            id: "7a000000-0000-4000-8000-000000000008",
            tenantId,
            expenseReportId: overdueSubmissionId,
            merchant: "Synthetic Rail",
            expenseDate: "2026-06-18",
            category: "Travel",
            amount: "84.25",
            currency: "USD",
            createdAt: seededAt,
            updatedAt: seededAt,
        })
        .onConflictDoUpdate({
            target: lineItem.id,
            set: {
                tenantId,
                expenseReportId: overdueSubmissionId,
                merchant: "Synthetic Rail",
                expenseDate: "2026-06-18",
                category: "Travel",
                amount: "84.25",
                currency: "USD",
                updatedAt: seededAt,
            },
        });
}

async function readCurrentLocalTotpCode(
    database: LocalAuthDatabase,
    environment: LocalAuthEnvironment,
    account: LocalAuthAccount,
): Promise<string> {
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
        .where(
            and(
                eq(user.tenantId, environment.VITE_TENANT_ID),
                eq(user.email, account.email),
            ),
        )
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

async function main(): Promise<void> {
    const environment = localAuthEnvironmentSchema.parse(process.env);
    const command = localAuthCommandSchema.parse(process.argv[2] ?? "seed");
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        if (command === "code") {
            const accountName = localAuthAccountNameSchema.parse(
                process.argv[3] ?? "employee",
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

        for (const account of getLocalAuthAccounts()) {
            await seedLocalAuthAccount(database, environment, account);
        }

        process.stdout.write(
            [
                "Synthetic local ExpenseFlow accounts are ready.",
                ...getLocalAuthAccounts().map(
                    (account) =>
                        `${account.name}: ${account.email} (${account.role})`,
                ),
                "Generate MFA with: npm run dev:auth:code -- <account>",
                "",
            ].join("\n"),
        );
    } finally {
        await pool.end();
    }
}

void main().catch(() => {
    process.stderr.write(
        "Unable to manage synthetic local auth accounts. Use only a loopback database and check local auth configuration.\n",
    );
    process.exitCode = 1;
});
