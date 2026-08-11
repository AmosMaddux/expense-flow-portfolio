import { and, eq, sql } from "drizzle-orm";
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
import { applyPendingCoreCaseMigrations } from "../db/migrations.js";
import {
    credential,
    expenseReport,
    glCodingResult,
    glCode,
    glMapping,
    lineItem,
    mfaEnrollment,
    role,
    user,
} from "../db/schema/index.js";
import * as schema from "../db/schema/index.js";
import {
    generateLocalTotpCode,
    getLocalTotpSecondsRemaining,
} from "./localTotp.js";

type E2eDatabase = NodePgDatabase<typeof schema>;
type E2eTransaction = Parameters<Parameters<E2eDatabase["transaction"]>[0]>[0];

const e2eCommandSchema = z.enum(["reset", "code", "verify"]);
const e2eAccountNameSchema = z.enum(["employee", "manager", "financeAdmin"]);
const e2eTenantId = "81000000-0000-4000-8000-000000000001";
const e2eCanaryTenantId = "81000000-0000-4000-8000-000000000011";
const e2eCanaryOwnerId = "81000000-0000-4000-8000-000000000012";
const e2eAsOfDate = "2026-07-31";
const e2eDatabaseName = "expenseflow_core_case";
const e2eDatabaseMarkerName = "pg_database description";
const e2eDatabaseMarkerValue = "expenseflow-core-case-deterministic-e2e-v1";
const e2ePasswordDefault = "expenseflow-e2e-local-only";
const e2eAccounts = {
    employee: {
        userId: "81000000-0000-4000-8000-000000000002",
        email: "employee.e2e@example.test",
        role: "Employee",
    },
    manager: {
        userId: "81000000-0000-4000-8000-000000000003",
        email: "manager.e2e@example.test",
        role: "Department Manager",
    },
    financeAdmin: {
        userId: "81000000-0000-4000-8000-000000000004",
        email: "finance.admin.e2e@example.test",
        role: "Finance Admin",
    },
} as const;
const e2eGlMappings = [
    {
        id: "81000000-0000-4000-8000-000000000101",
        category: "Travel",
        accountCode: "6100-E2E",
        accountName: "E2E Travel Expense",
    },
    {
        id: "81000000-0000-4000-8000-000000000102",
        category: "Meals",
        accountCode: "6200-E2E",
        accountName: "E2E Meals Expense",
    },
    {
        id: "81000000-0000-4000-8000-000000000103",
        category: "Lodging",
        accountCode: "6300-E2E",
        accountName: "E2E Lodging Expense",
    },
] as const;
const e2eCaseQueueReports = [
    {
        id: "81000000-0000-4000-8000-000000000201",
        currentStage: "Submitted",
        dueDate: "2026-07-01",
        tenantId: e2eTenantId,
    },
    {
        id: "81000000-0000-4000-8000-000000000202",
        currentStage: "Manager Approval",
        dueDate: "2026-08-15",
        tenantId: e2eTenantId,
    },
    {
        id: "81000000-0000-4000-8000-000000000211",
        currentStage: "Submitted",
        dueDate: "2026-07-01",
        tenantId: e2eCanaryTenantId,
    },
    {
        id: "81000000-0000-4000-8000-000000000212",
        currentStage: "AP Review",
        dueDate: "2026-07-01",
        tenantId: e2eCanaryTenantId,
    },
] as const;
const e2eApprovalQueueLineItem = {
    id: "81000000-0000-4000-8000-000000000301",
    expenseReportId: "81000000-0000-4000-8000-000000000201",
    merchant: "E2E Approval Queue Travel",
    expenseDate: "2026-07-01",
    amount: "120.00",
    currency: "USD",
    category: "Travel",
} as const;
const e2eApprovalQueueCodingResult = {
    id: "81000000-0000-4000-8000-000000000401",
    submissionId: "81000000-0000-4000-8000-000000000501",
} as const;

const localDatabaseHostnames = new Set(["127.0.0.1", "[::1]", "localhost"]);
const tenantOwnedTablesInDeleteOrder = [
    "receipt_metadata",
    "attachment_metadata",
    "case_comment",
    "reference_data_audit_entry",
    "gl_coding_result",
    "mileage_entry",
    "line_item",
    "expense_report_settlement",
    "stage_transition_outbox",
    "stage_transition_projection",
    "stage_transition",
    "audit_entry",
    "expense_report",
    "gl_mapping",
    "gl_code",
    "tenant_expense_policy",
    "refresh_token",
    "mfa_enrollment",
    "credential",
    "role",
    "authentication_audit_entry",
    "tenant_rate_limit_window",
    "user",
] as const;
const e2eEnvironmentSchema = z.object({
    DATABASE_URL: z.url().refine(isLocalDatabaseUrl, {
        message: "E2E data reset can connect only to a loopback database.",
    }),
    EXPENSEFLOW_E2E_PASSWORD: z.string().min(12).default(e2ePasswordDefault),
});

type E2eAccountName = z.infer<typeof e2eAccountNameSchema>;

/**
 * Resets the dedicated local E2E database to deterministic synthetic data.
 */
export async function resetE2eTestData(): Promise<void> {
    const environment = e2eEnvironmentSchema.parse(process.env);

    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        await assertDedicatedE2eDatabase(database);
        await applyPendingCoreCaseMigrations(environment.DATABASE_URL);
        await database.transaction(async (transaction) => {
            await clearE2eTenantData(transaction, [
                e2eTenantId,
                e2eCanaryTenantId,
            ]);
            await seedE2eTenantData(transaction, environment);
        });

        process.stdout.write(
            [
                "Synthetic E2E ExpenseFlow data is ready.",
                `tenant: ${e2eTenantId}`,
                `employee: ${e2eAccounts.employee.email}`,
                `manager: ${e2eAccounts.manager.email}`,
                `financeAdmin: ${e2eAccounts.financeAdmin.email}`,
                "roles: Employee, Department Manager, Finance Admin",
                "GL mappings: Travel, Meals, Lodging",
                "Case Queue reports: Submitted overdue, Manager Approval on track",
                "",
            ].join("\n"),
        );
    } finally {
        await pool.end();
    }
}

async function printE2eTotpCode(accountName: E2eAccountName): Promise<void> {
    const code = await readCurrentE2eAccountTotpCode(accountName);
    process.stdout.write(`${code}\n`);
}

/**
 * Reads the current deterministic TOTP code for a seeded local E2E account.
 */
export async function readCurrentE2eAccountTotpCode(
    accountName: E2eAccountName,
): Promise<string> {
    const environment = e2eEnvironmentSchema.parse(process.env);
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        await waitForUsefulTotpInterval();
        return await readCurrentE2eTotpCode(
            database,
            e2eTenantId,
            accountName,
        );
    } finally {
        await pool.end();
    }
}

async function verifyE2eTestData(): Promise<void> {
    const environment = e2eEnvironmentSchema.parse(process.env);
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        const [users, roles, mappings, reports, canaryReports, queueLineItems] =
            await Promise.all([
                database
                    .select({ id: user.id, email: user.email })
                    .from(user)
                    .where(eq(user.tenantId, e2eTenantId)),
                database
                    .select({ userId: role.userId, name: role.name })
                    .from(role)
                    .where(eq(role.tenantId, e2eTenantId)),
                database
                    .select({ category: glMapping.category })
                    .from(glMapping)
                    .where(eq(glMapping.tenantId, e2eTenantId)),
                database
                    .select({
                        currentStage: expenseReport.currentStage,
                        dueDate: expenseReport.dueDate,
                        tenantId: expenseReport.tenantId,
                    })
                    .from(expenseReport)
                    .where(eq(expenseReport.tenantId, e2eTenantId)),
                database
                    .select({
                        currentStage: expenseReport.currentStage,
                        dueDate: expenseReport.dueDate,
                        tenantId: expenseReport.tenantId,
                    })
                    .from(expenseReport)
                    .where(eq(expenseReport.tenantId, e2eCanaryTenantId)),
                database
                    .select({
                        amount: glCodingResult.amount,
                        expenseReportId: glCodingResult.expenseReportId,
                        glAccountCode: glCodingResult.glAccountCode,
                        id: lineItem.id,
                        merchant: lineItem.merchant,
                        tenantId: lineItem.tenantId,
                    })
                    .from(lineItem)
                    .innerJoin(
                        glCodingResult,
                        and(
                            eq(glCodingResult.tenantId, lineItem.tenantId),
                            eq(glCodingResult.sourceId, lineItem.id),
                        ),
                    )
                    .where(eq(lineItem.tenantId, e2eTenantId)),
            ]);
        const seededUsersByEmail = new Map(
            users.map((seededUser) => [seededUser.email, seededUser]),
        );
        const seededRolesByUserId = new Map(
            roles.map((seededRole) => [seededRole.userId, seededRole.name]),
        );
        const financeAccount = seededUsersByEmail.get(
            e2eAccounts.financeAdmin.email,
        );

        if (
            users.length !== 3 ||
            roles.length !== 3 ||
            mappings.length !== e2eGlMappings.length ||
            reports.length !== 2 ||
            !matchesExpectedReports(reports, [
                {
                    currentStage: "Submitted",
                    dueDate: "2026-07-01",
                    tenantId: e2eTenantId,
                },
                {
                    currentStage: "Manager Approval",
                    dueDate: "2026-08-15",
                    tenantId: e2eTenantId,
                },
            ]) ||
            canaryReports.length !== 2 ||
            !matchesExpectedReports(canaryReports, [
                {
                    currentStage: "Submitted",
                    dueDate: "2026-07-01",
                    tenantId: e2eCanaryTenantId,
                },
                {
                    currentStage: "AP Review",
                    dueDate: "2026-07-01",
                    tenantId: e2eCanaryTenantId,
                },
            ]) ||
            queueLineItems.length !== 1 ||
            queueLineItems[0]?.id !== e2eApprovalQueueLineItem.id ||
            queueLineItems[0].tenantId !== e2eTenantId ||
            queueLineItems[0].expenseReportId !==
                e2eApprovalQueueLineItem.expenseReportId ||
            queueLineItems[0].merchant !== e2eApprovalQueueLineItem.merchant ||
            queueLineItems[0].amount !== e2eApprovalQueueLineItem.amount ||
            queueLineItems[0].glAccountCode !== "6100-E2E" ||
            financeAccount === undefined ||
            seededRolesByUserId.get(financeAccount.id) !==
                e2eAccounts.financeAdmin.role
        ) {
            throw new Error(
                `Unexpected E2E seed counts: users=${users.length}, roles=${roles.length}, glMappings=${mappings.length}, reports=${reports.length}, canaryReports=${canaryReports.length}, queueLineItems=${queueLineItems.length}.`,
            );
        }

        process.stdout.write(
            `Synthetic E2E data verification passed: 3 users, 3 roles, 3 GL mappings, 2 tenant reports as of ${e2eAsOfDate}.\n`,
        );
    } finally {
        await pool.end();
    }
}

function matchesExpectedReports(
    reports: Array<{
        currentStage: string;
        dueDate: string;
        tenantId: string;
    }>,
    expectedReports: Array<{
        currentStage: string;
        dueDate: string;
        tenantId: string;
    }>,
): boolean {
    return expectedReports.every((expectedReport) =>
        reports.some(
            (report) =>
                report.currentStage === expectedReport.currentStage &&
                report.dueDate === expectedReport.dueDate &&
                report.tenantId === expectedReport.tenantId,
        ),
    );
}

async function clearE2eTenantData(
    transaction: E2eTransaction,
    tenantIds: string[],
): Promise<void> {
    await transaction.execute(
        sql`alter table "audit_entry" disable trigger "audit_entry_prevent_mutation_trigger"`,
    );
    await transaction.execute(
        sql`alter table "case_comment" disable trigger "case_comment_prevent_mutation_trigger"`,
    );

    try {
        for (const tenantId of tenantIds) {
            for (const tableName of tenantOwnedTablesInDeleteOrder) {
                await transaction.execute(
                    sql`delete from ${sql.identifier(tableName)} where tenant_id = ${tenantId}`,
                );
            }
        }
    } finally {
        await transaction.execute(
            sql`alter table "case_comment" enable trigger "case_comment_prevent_mutation_trigger"`,
        );
        await transaction.execute(
            sql`alter table "audit_entry" enable trigger "audit_entry_prevent_mutation_trigger"`,
        );
    }
}

async function seedE2eTenantData(
    transaction: E2eTransaction,
    environment: z.infer<typeof e2eEnvironmentSchema>,
): Promise<void> {
    const passwordHash = await createPasswordHasher(
        loadPasswordHashConfig(),
    ).hashPassword(environment.EXPENSEFLOW_E2E_PASSWORD);

    for (const account of Object.values(e2eAccounts)) {
        await transaction.insert(user).values({
            id: account.userId,
            tenantId: e2eTenantId,
            email: account.email,
        });
        await transaction.insert(credential).values({
            tenantId: e2eTenantId,
            userId: account.userId,
            passwordHash,
            passwordHashAlgorithm: "argon2id",
        });
        await transaction.insert(role).values({
            tenantId: e2eTenantId,
            userId: account.userId,
            name: account.role,
        });
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
            createTotpSecretProtector(),
        ).enroll({
            tenantId: e2eTenantId,
            userId: account.userId,
            email: account.email,
        });
    }
    await transaction.insert(user).values({
        id: e2eCanaryOwnerId,
        tenantId: e2eCanaryTenantId,
        email: "canary.manager.e2e@example.test",
    });

    for (const mapping of e2eGlMappings) {
        await transaction.insert(glCode).values({
            id: mapping.id,
            tenantId: e2eTenantId,
            accountCode: mapping.accountCode,
            accountName: mapping.accountName,
            description: "Synthetic E2E GL reference data.",
        });
        await transaction.insert(glMapping).values({
            tenantId: e2eTenantId,
            category: mapping.category,
            glCodeId: mapping.id,
        });
    }

    for (const report of e2eCaseQueueReports) {
        await transaction.insert(expenseReport).values({
            id: report.id,
            tenantId: report.tenantId,
            owner:
                report.tenantId === e2eTenantId
                    ? e2eAccounts.manager.userId
                    : e2eCanaryOwnerId,
            dueDate: report.dueDate,
            currentStage: report.currentStage,
            priority: "Normal",
        });
    }

    await transaction.insert(lineItem).values({
        id: e2eApprovalQueueLineItem.id,
        tenantId: e2eTenantId,
        expenseReportId: e2eApprovalQueueLineItem.expenseReportId,
        merchant: e2eApprovalQueueLineItem.merchant,
        expenseDate: e2eApprovalQueueLineItem.expenseDate,
        amount: e2eApprovalQueueLineItem.amount,
        currency: e2eApprovalQueueLineItem.currency,
        category: e2eApprovalQueueLineItem.category,
    });
    await transaction.insert(glCodingResult).values({
        id: e2eApprovalQueueCodingResult.id,
        tenantId: e2eTenantId,
        expenseReportId: e2eApprovalQueueLineItem.expenseReportId,
        sourceType: "line_item",
        sourceId: e2eApprovalQueueLineItem.id,
        submissionId: e2eApprovalQueueCodingResult.submissionId,
        category: e2eApprovalQueueLineItem.category,
        mappingStatus: "mapped",
        glAccountCode: "6100-E2E",
        glAccountName: "E2E Travel Expense",
        amount: e2eApprovalQueueLineItem.amount,
        currency: e2eApprovalQueueLineItem.currency,
    });
}

async function assertDedicatedE2eDatabase(
    database: E2eDatabase,
): Promise<void> {
    const identityResult = await database.execute<{
        databaseName: string;
        markerValue: string | null;
    }>(
        sql`
            select
                current_database() as "databaseName",
                shobj_description(pg_database.oid, 'pg_database') as "markerValue"
            from pg_database
            where datname = current_database()
        `,
    );
    const identity = identityResult.rows[0];

    if (
        identity?.databaseName !== e2eDatabaseName ||
        identity.markerValue !== e2eDatabaseMarkerValue
    ) {
        throw new Error(
            [
                "Refusing to reset E2E data because DATABASE_URL is not the dedicated synthetic E2E database.",
                `Expected database ${e2eDatabaseName} with marker ${e2eDatabaseMarkerName}=${e2eDatabaseMarkerValue}.`,
            ].join(" "),
        );
    }
}

async function readCurrentE2eTotpCode(
    database: E2eDatabase,
    tenantId: string,
    accountName: E2eAccountName,
): Promise<string> {
    const account = e2eAccounts[accountName];
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
        throw new Error("Synthetic E2E MFA enrollment was not found.");
    }

    const protectedSecret: ProtectedTotpSecret = {
        secretCiphertext: enrollment.secretCiphertext,
        secretIv: enrollment.secretIv,
        secretAuthTag: enrollment.secretAuthTag,
        secretKeyVersion: enrollment.secretKeyVersion,
    };
    const secret = createTotpSecretProtector()
        .reveal(protectedSecret)
        .toString("utf8");

    return generateLocalTotpCode(
        secret,
        enrollment.digits,
        enrollment.periodSeconds,
    );
}

async function waitForUsefulTotpInterval(): Promise<void> {
    const secondsRemaining = getLocalTotpSecondsRemaining(30);

    if (secondsRemaining >= 10) {
        return;
    }

    await new Promise<void>((resolve) => {
        setTimeout(resolve, (secondsRemaining + 1) * 1000);
    });
}

function isLocalDatabaseUrl(value: string): boolean {
    try {
        return localDatabaseHostnames.has(new URL(value).hostname);
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const command = e2eCommandSchema.parse(process.argv[2] ?? "reset");

    if (command === "code") {
        await printE2eTotpCode(e2eAccountNameSchema.parse(process.argv[3]));
        return;
    }

    if (command === "verify") {
        await verifyE2eTestData();
        return;
    }

    await resetE2eTestData();
}

if (process.argv[1]?.endsWith("e2eTestData.js") === true) {
    void main().catch((error: unknown) => {
        process.stderr.write(
            error instanceof Error
                ? `${error.message}\n`
                : "Unable to prepare synthetic E2E data.\n",
        );
        process.exitCode = 1;
    });
}

export const e2eWalkthroughAccounts = e2eAccounts;
export const e2eWalkthroughPassword = e2ePasswordDefault;
export const e2eWalkthroughTenantId = e2eTenantId;
