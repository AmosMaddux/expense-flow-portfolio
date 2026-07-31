import { z } from "zod";

import { roleValues, type RoleName } from "../db/schema/identityAuth.js";

export const localAuthAccountNameSchema = z.enum([
    "employee",
    "manager",
    "finance-admin",
    "platform-admin",
]);

export type LocalAuthAccountName = z.infer<typeof localAuthAccountNameSchema>;

export type LocalAuthAccount = {
    name: LocalAuthAccountName;
    userId: string;
    email: string;
    role: RoleName;
};

const localDatabaseHostnames = new Set(["127.0.0.1", "[::1]", "localhost"]);

const localAuthAccounts = [
    {
        name: "employee",
        userId: "cf8ea46a-778d-4634-9363-f4864a3d4424",
        email: "employee@example.invalid",
        role: "Employee",
    },
    {
        name: "manager",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000002",
        email: "manager@example.invalid",
        role: "Department Manager",
    },
    {
        name: "finance-admin",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000003",
        email: "finance-admin@example.invalid",
        role: "Finance Admin",
    },
    {
        name: "platform-admin",
        userId: "9f1b3f5c-1dc8-4f37-8a23-000000000004",
        email: "platform-admin@example.invalid",
        role: "Admin",
    },
] as const satisfies readonly LocalAuthAccount[];

export const localAuthEnvironmentSchema = z.object({
    DATABASE_URL: z.url().refine(isLocalDatabaseUrl, {
        message:
            "The synthetic auth bootstrap can connect only to a loopback database.",
    }),
    VITE_TENANT_ID: z.uuid().default("8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb"),
    EXPENSEFLOW_DEV_PASSWORD: z
        .string()
        .min(12)
        .default("expenseflow-local-dev-only"),
});

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

if (roleValues.length !== 4) {
    throw new Error(
        "Local auth accounts must be reviewed when supported roles change.",
    );
}
