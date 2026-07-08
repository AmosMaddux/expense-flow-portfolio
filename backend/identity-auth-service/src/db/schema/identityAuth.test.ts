import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import {
    credential,
    refreshToken,
    role,
    roleValues,
    user,
} from "./identityAuth.js";

const tables = [user, credential, role, refreshToken];

function columnNamesFor(table: (typeof tables)[number]): string[] {
    return getTableConfig(table).columns.map((column) => column.name);
}

void describe("identityAuth schema", () => {
    void test("exports the approved repository role values", () => {
        expect(roleValues).toStrictEqual([
            "Finance Admin",
            "Department Manager",
            "Employee",
            "Admin",
        ]);
    });

    void test("defines user, credential, role, and refresh_token tables", () => {
        expect(getTableName(user)).toEqual("user");
        expect(getTableName(credential)).toEqual("credential");
        expect(getTableName(role)).toEqual("role");
        expect(getTableName(refreshToken)).toEqual("refresh_token");
    });

    void test("requires tenant_id on every identity table", () => {
        for (const table of tables) {
            const tenantId = getTableConfig(table).columns.find(
                (column) => column.name === "tenant_id",
            );

            expect(tenantId).toBeDefined();

            if (tenantId !== undefined) {
                expect(tenantId.notNull).toBeTruthy();
            }
        }
    });

    void test("stores only password hashes in credential rows", () => {
        const columnNames = columnNamesFor(credential);

        expect(columnNames).toContain("password_hash");
        expect(columnNames).toContain("password_hash_algorithm");
        expect(columnNames).not.toContain("password");
        expect(columnNames).not.toContain("plain_password");
        expect(columnNames).not.toContain("plaintext_password");
    });

    void test("stores only token hashes in refresh token rows", () => {
        const columnNames = columnNamesFor(refreshToken);

        expect(columnNames).toContain("token_hash");
        expect(columnNames).not.toContain("token");
        expect(columnNames).not.toContain("refresh_token");
        expect(columnNames).not.toContain("plaintext_token");
    });

    void test("keeps tenant-scoped constraints and indexes on child tables", () => {
        expect(
            getTableConfig(user).indexes.map(
                (indexConfig) => indexConfig.config.name,
            ),
        ).toEqual([
            "user_tenant_email_unique_idx",
            "user_tenant_id_unique_idx",
        ]);

        expect(
            getTableConfig(credential).foreignKeys.map((key) => key.getName()),
        ).toEqual(["credential_user_tenant_fk"]);
        expect(
            getTableConfig(role).checks.map((constraint) => constraint.name),
        ).toEqual(["role_name_check"]);
        expect(
            getTableConfig(role).foreignKeys.map((key) => key.getName()),
        ).toEqual(["role_user_tenant_fk"]);
        expect(
            getTableConfig(refreshToken).foreignKeys.map((key) =>
                key.getName(),
            ),
        ).toEqual(["refresh_token_user_tenant_fk"]);
    });
});
