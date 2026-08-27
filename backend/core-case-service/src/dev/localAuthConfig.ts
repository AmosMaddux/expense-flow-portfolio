import { z } from "zod";

import { roleValues, type RoleName } from "../db/schema/identityAuth.js";

export const localAuthAccountNameSchema = z.enum([
    "employee-1",
    "employee-1b",
    "employee-2",
    "employee-2b",
    "manager-1",
    "manager-2",
    "finance-admin-1",
    "finance-admin-2",
    "platform-admin-1",
    "platform-admin-2",
]);

export type LocalAuthAccountName = z.infer<typeof localAuthAccountNameSchema>;

const localAuthAccountAliasSchema = z.enum([
    "employee",
    "manager",
    "finance-admin",
    "platform-admin",
]);

const localAuthAccountAliases = {
    employee: "employee-1",
    manager: "manager-1",
    "finance-admin": "finance-admin-1",
    "platform-admin": "platform-admin-1",
} as const satisfies Record<
    z.infer<typeof localAuthAccountAliasSchema>,
    LocalAuthAccountName
>;

export type LocalAuthAccount = {
    name: LocalAuthAccountName;
    tenant: "primary" | "secondary";
    userId: string;
    email: string;
    displayName: string;
    role: RoleName;
};

const localDatabaseHostnames = new Set([
    "127.0.0.1",
    "[::1]",
    "localhost",
    "postgres",
]);

const localAuthAccounts = [
    {
        name: "employee-1",
        tenant: "primary",
        userId: "cf8ea46a-778d-4634-9363-f4864a3d4424",
        email: "employee@example1.invalid",
        displayName: "Alex Employee",
        role: "Employee",
    },
    {
        name: "employee-1b",
        tenant: "primary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000009",
        email: "employee2@example1.invalid",
        displayName: "Bailey Employee",
        role: "Employee",
    },
    {
        name: "employee-2",
        tenant: "secondary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000005",
        email: "employee@example2.invalid",
        displayName: "Casey Employee",
        role: "Employee",
    },
    {
        name: "employee-2b",
        tenant: "secondary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000010",
        email: "employee2@example2.invalid",
        displayName: "Drew Employee",
        role: "Employee",
    },
    {
        name: "manager-1",
        tenant: "primary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000002",
        email: "manager@example1.invalid",
        displayName: "Morgan Manager",
        role: "Department Manager",
    },
    {
        name: "manager-2",
        tenant: "secondary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000006",
        email: "manager@example2.invalid",
        displayName: "Riley Manager",
        role: "Department Manager",
    },
    {
        name: "finance-admin-1",
        tenant: "primary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000003",
        email: "finance-admin@example1.invalid",
        displayName: "Jordan Finance",
        role: "Finance Admin",
    },
    {
        name: "finance-admin-2",
        tenant: "secondary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000007",
        email: "finance-admin@example2.invalid",
        displayName: "Taylor Finance",
        role: "Finance Admin",
    },
    {
        name: "platform-admin-1",
        tenant: "primary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000004",
        email: "platform-admin@example1.invalid",
        displayName: "Sam Platform",
        role: "Admin",
    },
    {
        name: "platform-admin-2",
        tenant: "secondary",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000008",
        email: "platform-admin@example2.invalid",
        displayName: "Quinn Platform",
        role: "Admin",
    },
] as const satisfies readonly LocalAuthAccount[];

export const localAuthEnvironmentSchema = z
    .object({
        DATABASE_URL: z.url(),
        VITE_TENANT_ID: z
            .uuid()
            .default("8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb"),
        VITE_SECONDARY_TENANT_ID: z
            .uuid()
            .default("8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fc"),
        EXPENSEFLOW_DEV_PASSWORD: z
            .string()
            .min(12)
            .default("expenseflow-local-dev-only"),
        // Deliberately opt-in only: the sandbox bastion (infra/terraform/modules/bastion,
        // scripts/aws/bastion-run.sh) sets this to seed synthetic accounts against the
        // real sandbox database, which is not a loopback host. Never set for local dev.
        ALLOW_NON_LOOPBACK_AUTH_SEED: z
            .enum(["true", "false"])
            .default("false"),
    })
    .refine(
        (environment) =>
            environment.VITE_TENANT_ID !== environment.VITE_SECONDARY_TENANT_ID,
        {
            message: "Synthetic tenant IDs must be different.",
            path: ["VITE_SECONDARY_TENANT_ID"],
        },
    )
    .refine(
        (environment) =>
            environment.ALLOW_NON_LOOPBACK_AUTH_SEED === "true" ||
            isLocalDatabaseUrl(environment.DATABASE_URL),
        {
            message:
                "The synthetic auth bootstrap can connect only to a loopback database, unless ALLOW_NON_LOOPBACK_AUTH_SEED=true.",
            path: ["DATABASE_URL"],
        },
    );

export type LocalAuthEnvironment = z.infer<typeof localAuthEnvironmentSchema>;

/**
 * Returns whether a database URL resolves explicitly to this workstation.
 */
export function isLocalDatabaseUrl(value: string): boolean {
    try {
        return localDatabaseHostnames.has(new URL(value).hostname);
    } catch {
        return false;
    }
}

/**
 * Returns every fixed synthetic identity used for local role testing.
 */
export function getLocalAuthAccounts(): readonly LocalAuthAccount[] {
    return localAuthAccounts;
}

/**
 * Returns the fixed synthetic identity for a local account alias.
 */
export function getLocalAuthAccount(
    name: LocalAuthAccountName,
): LocalAuthAccount {
    return localAuthAccounts.find((account) => account.name === name)!;
}

/**
 * Resolves a local auth CLI account argument to a fixed synthetic identity name.
 */
export function resolveLocalAuthAccountName(
    value: string,
): LocalAuthAccountName {
    const accountName = localAuthAccountNameSchema.safeParse(value);
    if (accountName.success) {
        return accountName.data;
    }

    const accountAlias = localAuthAccountAliasSchema.safeParse(value);
    if (accountAlias.success) {
        return localAuthAccountAliases[accountAlias.data];
    }

    return localAuthAccountNameSchema.parse(value);
}

/**
 * Resolves an account's tenant from trusted local seed configuration.
 */
export function getLocalAuthAccountTenantId(
    environment: LocalAuthEnvironment,
    account: LocalAuthAccount,
): string {
    return account.tenant === "primary"
        ? environment.VITE_TENANT_ID
        : environment.VITE_SECONDARY_TENANT_ID;
}

if (roleValues.length !== 4) {
    throw new Error(
        "Local auth accounts must be reviewed when supported roles change.",
    );
}
