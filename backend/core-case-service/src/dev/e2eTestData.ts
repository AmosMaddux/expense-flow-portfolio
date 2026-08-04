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
    glCode,
    glMapping,
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
const e2eAccountNameSchema = z.enum(["employee", "manager", "finance"]);
const e2eTenantId = "81000000-0000-4000-8000-000000000001";
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
    finance: {
        userId: "81000000-0000-4000-8000-000000000004",
        email: "finance.e2e@example.test",
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

const localDatabaseHostnames = new Set(["127.0.0.1", "[::1]", "localhost"]);
const tenantOwnedTablesInDeleteOrder = [
    "receipt_metadata",
    "attachment_metadata",
    "case_comment",
    "reference_data_audit_entry",
    "gl_coding_result",
    "mileage_entry",
    "line_item",
    "stage_transition",
    "audit_entry",
    "expense_report",
    "gl_mapping",
    "gl_code",
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

async function resetE2eTestData(): Promise<void> {
    const environment = e2eEnvironmentSchema.parse(process.env);

    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        await assertDedicatedE2eDatabase(database);
        await applyPendingCoreCaseMigrations(environment.DATABASE_URL);
        await database.transaction(async (transaction) => {
            await clearE2eTenantData(transaction);
            await seedE2eTenantData(transaction, environment);
        });

        process.stdout.write(
            [
                "Synthetic E2E ExpenseFlow data is ready.",
                `tenant: ${e2eTenantId}`,
                `employee: ${e2eAccounts.employee.email}`,
                `manager: ${e2eAccounts.manager.email}`,
                `finance: ${e2eAccounts.finance.email}`,
                "roles: Employee, Department Manager, Finance Admin",
                "GL mappings: Travel, Meals, Lodging",
                "",
            ].join("\n"),
        );
    } finally {
        await pool.end();
    }
}

async function printE2eTotpCode(accountName: E2eAccountName): Promise<void> {
    const environment = e2eEnvironmentSchema.parse(process.env);
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        await waitForUsefulTotpInterval();
        const code = await readCurrentE2eTotpCode(
            database,
            e2eTenantId,
            accountName,
        );
        process.stdout.write(`${code}\n`);
    } finally {
        await pool.end();
    }
}

async function verifyE2eTestData(): Promise<void> {
    const environment = e2eEnvironmentSchema.parse(process.env);
    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });

    try {
        const [users, roles, mappings, reports] = await Promise.all([
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
                .select({ id: expenseReport.id })
                .from(expenseReport)
                .where(eq(expenseReport.tenantId, e2eTenantId)),
        ]);
        const seededUsersByEmail = new Map(
            users.map((seededUser) => [seededUser.email, seededUser]),
        );
        const seededRolesByUserId = new Map(
            roles.map((seededRole) => [seededRole.userId, seededRole.name]),
        );
        const financeAccount = seededUsersByEmail.get(
            e2eAccounts.finance.email,
        );

        if (
            users.length !== 3 ||
            roles.length !== 3 ||
            mappings.length !== e2eGlMappings.length ||
            reports.length !== 0 ||
            financeAccount === undefined ||
            seededRolesByUserId.get(financeAccount.id) !==
                e2eAccounts.finance.role
        ) {
            throw new Error(
                `Unexpected E2E seed counts: users=${users.length}, roles=${roles.length}, glMappings=${mappings.length}, reports=${reports.length}.`,
            );
        }

        process.stdout.write(
            "Synthetic E2E data verification passed: 3 users, 3 roles, 3 GL mappings, 0 reports.\n",
        );
    } finally {
        await pool.end();
    }
}

async function clearE2eTenantData(transaction: E2eTransaction): Promise<void> {
    await transaction.execute(
        sql`alter table "audit_entry" disable trigger "audit_entry_prevent_mutation_trigger"`,
    );
    await transaction.execute(
        sql`alter table "case_comment" disable trigger "case_comment_prevent_mutation_trigger"`,
    );

    try {
        for (const tableName of tenantOwnedTablesInDeleteOrder) {
            await transaction.execute(
                sql`delete from ${sql.identifier(tableName)} where tenant_id = ${e2eTenantId}`,
            );
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

void main().catch((error: unknown) => {
    process.stderr.write(
        error instanceof Error
            ? `${error.message}\n`
            : "Unable to prepare synthetic E2E data.\n",
    );
    process.exitCode = 1;
});
