import { describe, expect, test } from "vitest";

import {
    getLocalAuthAccounts,
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

    test("defines one unique synthetic identity for every supported role", () => {
        const accounts = getLocalAuthAccounts();

        expect(accounts.map((account) => account.role).sort()).toEqual(
            ["Admin", "Department Manager", "Employee", "Finance Admin"].sort(),
        );
        expect(new Set(accounts.map((account) => account.userId)).size).toBe(4);
        expect(new Set(accounts.map((account) => account.email)).size).toBe(4);
    });
});
