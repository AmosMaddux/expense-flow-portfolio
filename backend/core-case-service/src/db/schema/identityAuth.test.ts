import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import {
    authenticationAuditEntry,
    credential,
    mfaEnrollment,
    refreshToken,
    role,
    roleValues,
    user,
} from "./identityAuth.js";

const tables = [
    user,
    credential,
    role,
    refreshToken,
    mfaEnrollment,
    authenticationAuditEntry,
];

function columnNamesFor(table: (typeof tables)[number]): string[] {
    return getTableConfig(table).columns.map((column) => column.name);
}

function foreignKeyReferencesFor(
    table:
        | typeof credential
        | typeof role
        | typeof refreshToken
        | typeof mfaEnrollment
        | typeof authenticationAuditEntry,
) {
    return getTableConfig(table).foreignKeys.map((foreignKeyConfig) => {
        const reference = foreignKeyConfig.reference();

        return {
            columns: reference.columns.map((column) => column.name),
            foreignColumns: reference.foreignColumns.map(
                (column) => column.name,
            ),
            name: foreignKeyConfig.getName(),
        };
    });
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

    void test("defines identity auth tables", () => {
        expect(getTableName(user)).toEqual("user");
        expect(getTableName(credential)).toEqual("credential");
        expect(getTableName(role)).toEqual("role");
        expect(getTableName(refreshToken)).toEqual("refresh_token");
        expect(getTableName(mfaEnrollment)).toEqual("mfa_enrollment");
        expect(getTableName(authenticationAuditEntry)).toEqual(
            "authentication_audit_entry",
        );
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

    void test("stores protected TOTP secrets in MFA enrollment rows", () => {
        const columnNames = columnNamesFor(mfaEnrollment);
        const tableConfig = getTableConfig(mfaEnrollment);

        expect(columnNames).toEqual([
            "id",
            "tenant_id",
            "user_id",
            "secret_ciphertext",
            "secret_iv",
            "secret_auth_tag",
            "secret_key_version",
            "algorithm",
            "digits",
            "period_seconds",
            "created_at",
            "updated_at",
        ]);
        expect(columnNames).not.toContain("secret");
        expect(columnNames).not.toContain("totp_secret");
        expect(columnNames).not.toContain("plain_secret");
        expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
            [
                "mfa_enrollment_secret_ciphertext_not_blank_check",
                "mfa_enrollment_secret_iv_not_blank_check",
                "mfa_enrollment_secret_auth_tag_not_blank_check",
                "mfa_enrollment_secret_key_version_not_blank_check",
                "mfa_enrollment_algorithm_check",
                "mfa_enrollment_digits_check",
                "mfa_enrollment_period_seconds_positive_check",
            ],
        );
        expect(foreignKeyReferencesFor(mfaEnrollment)).toEqual([
            {
                columns: ["tenant_id", "user_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "mfa_enrollment_user_tenant_fk",
            },
        ]);
        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "mfa_enrollment_tenant_user_unique_idx",
            "mfa_enrollment_tenant_user_idx",
        ]);
    });

    void test("keeps tenant-scoped constraints and indexes on child tables", () => {
        const userIndexes = getTableConfig(user).indexes;
        const userEmailIndex = userIndexes.find(
            (indexConfig) =>
                indexConfig.config.name === "user_tenant_email_unique_idx",
        );
        const userTenantIdIndex = userIndexes.find(
            (indexConfig) =>
                indexConfig.config.name === "user_tenant_id_unique_idx",
        );

        expect(
            userIndexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "user_tenant_email_unique_idx",
            "user_tenant_id_unique_idx",
        ]);
        expect(userEmailIndex?.config.unique).toBeTruthy();
        expect(userTenantIdIndex?.config.unique).toBeTruthy();

        expect(foreignKeyReferencesFor(credential)).toEqual([
            {
                columns: ["tenant_id", "user_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "credential_user_tenant_fk",
            },
        ]);
        expect(
            getTableConfig(role).checks.map((constraint) => constraint.name),
        ).toEqual(["role_name_check"]);
        expect(foreignKeyReferencesFor(role)).toEqual([
            {
                columns: ["tenant_id", "user_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "role_user_tenant_fk",
            },
        ]);

        const refreshTokenIndexes = getTableConfig(refreshToken).indexes;
        const refreshTokenHashIndex = refreshTokenIndexes.find(
            (indexConfig) =>
                indexConfig.config.name ===
                "refresh_token_token_hash_unique_idx",
        );

        expect(foreignKeyReferencesFor(refreshToken)).toEqual([
            {
                columns: ["tenant_id", "user_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "refresh_token_user_tenant_fk",
            },
        ]);
        expect(
            refreshTokenIndexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "refresh_token_token_hash_unique_idx",
            "refresh_token_tenant_user_idx",
            "refresh_token_tenant_expires_at_idx",
        ]);
        expect(refreshTokenHashIndex?.config.unique).toBeTruthy();
    });

    void test("keeps failed login audit entries tenant-scoped and queryable", () => {
        const tableConfig = getTableConfig(authenticationAuditEntry);

        expect(columnNamesFor(authenticationAuditEntry)).toEqual([
            "id",
            "tenant_id",
            "user_id",
            "action",
            "email",
            "created_at",
        ]);
        expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
            [
                "authentication_audit_entry_action_check",
                "authentication_audit_entry_email_not_blank_check",
            ],
        );
        expect(foreignKeyReferencesFor(authenticationAuditEntry)).toEqual([
            {
                columns: ["tenant_id", "user_id"],
                foreignColumns: ["tenant_id", "id"],
                name: "authentication_audit_entry_user_tenant_fk",
            },
        ]);
        expect(
            tableConfig.indexes.map((indexConfig) => indexConfig.config.name),
        ).toEqual([
            "authentication_audit_entry_tenant_created_at_idx",
            "authentication_audit_entry_tenant_user_created_at_idx",
        ]);
    });
});
