import { describe, expect, test } from "vitest";

import {
    getLocalAuthAccounts,
    getLocalAuthAccountTenantId,
    isLocalDatabaseUrl,
    localAuthEnvironmentSchema,
} from "./localAuthConfig.js";

describe("local auth configuration", () => {
    test.each([
        "postgres://expenseflow:synthetic@127.0.0.1:55432/expenseflow_core_case",
        "postgres://expenseflow:synthetic@localhost:55432/expenseflow_core_case",
        "postgres://expenseflow:synthetic@[::1]:55432/expenseflow_core_case",
    ])("accepts the loopback database URL %s", (databaseUrl) => {
        expect(isLocalDatabaseUrl(databaseUrl)).toBe(true);
        expect(() =>
            localAuthEnvironmentSchema.parse({ DATABASE_URL: databaseUrl }),
        ).not.toThrow();
    });

    test.each([
        "postgres://expenseflow:synthetic@database.internal:5432/expenseflow",
        "postgres://expenseflow:synthetic@192.0.2.10:5432/expenseflow",
        "not-a-database-url",
    ])("rejects the non-local database URL %s", (databaseUrl) => {
        expect(isLocalDatabaseUrl(databaseUrl)).toBe(false);
        expect(() =>
            localAuthEnvironmentSchema.parse({ DATABASE_URL: databaseUrl }),
        ).toThrow();
    });

    test("defines one unique synthetic identity per role in each tenant", () => {
        const accounts = getLocalAuthAccounts();

        for (const tenant of ["primary", "secondary"] as const) {
            const tenantAccounts = accounts.filter(
                (account) => account.tenant === tenant,
            );

            expect(tenantAccounts).toHaveLength(5);
            expect(
                tenantAccounts.filter((account) => account.role === "Employee"),
            ).toHaveLength(2);
            expect(
                new Set(tenantAccounts.map((account) => account.role)),
            ).toEqual(
                new Set([
                    "Admin",
                    "Department Manager",
                    "Employee",
                    "Finance Admin",
                ]),
            );
        }
        expect(new Set(accounts.map((account) => account.userId)).size).toBe(
            10,
        );
        expect(new Set(accounts.map((account) => account.email)).size).toBe(10);
    });

    test("resolves each synthetic cohort to a different tenant", () => {
        const environment = localAuthEnvironmentSchema.parse({
            DATABASE_URL:
                "postgres://expenseflow:synthetic@localhost:55432/expenseflow_core_case",
            VITE_TENANT_ID: "10000000-0000-4000-8000-000000000001",
            VITE_SECONDARY_TENANT_ID: "20000000-0000-4000-8000-000000000002",
        });
        const accounts = getLocalAuthAccounts();

        expect(
            new Set(
                accounts
                    .filter((account) => account.tenant === "primary")
                    .map((account) =>
                        getLocalAuthAccountTenantId(environment, account),
                    ),
            ),
        ).toEqual(new Set([environment.VITE_TENANT_ID]));
        expect(
            new Set(
                accounts
                    .filter((account) => account.tenant === "secondary")
                    .map((account) =>
                        getLocalAuthAccountTenantId(environment, account),
                    ),
            ),
        ).toEqual(new Set([environment.VITE_SECONDARY_TENANT_ID]));
    });

    test("rejects matching tenant IDs", () => {
        const sharedTenantId = "10000000-0000-4000-8000-000000000001";

        expect(() =>
            localAuthEnvironmentSchema.parse({
                DATABASE_URL:
                    "postgres://expenseflow:synthetic@localhost:55432/expenseflow_core_case",
                VITE_TENANT_ID: sharedTenantId,
                VITE_SECONDARY_TENANT_ID: sharedTenantId,
            }),
        ).toThrow("Synthetic tenant IDs must be different.");
    });
});
