import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

export const roleValues = [
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
] as const;

const roleValueCheckSql = sql.join(
    roleValues.map((roleValue) => sql`${roleValue}`),
    sql`, `,
);

export const user = pgTable(
    "user",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        email: text("email").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "user_email_not_blank_check",
            sql`nullif(btrim(${table.email}), '') is not null`,
        ),
        uniqueIndex("user_tenant_email_unique_idx").on(
            table.tenantId,
            table.email,
        ),
        // Child tables use this key so their tenant_id must match the parent user.
        uniqueIndex("user_tenant_id_unique_idx").on(table.tenantId, table.id),
    ],
);

export const credential = pgTable(
    "credential",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        userId: uuid("user_id").notNull(),
        passwordHash: text("password_hash").notNull(),
        passwordHashAlgorithm: text("password_hash_algorithm").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "credential_password_hash_not_blank_check",
            sql`nullif(btrim(${table.passwordHash}), '') is not null`,
        ),
        check(
            "credential_password_hash_algorithm_not_blank_check",
            sql`nullif(btrim(${table.passwordHashAlgorithm}), '') is not null`,
        ),
        foreignKey({
            name: "credential_user_tenant_fk",
            // Tenant joins prevent credentials from attaching to another tenant's user.
            columns: [table.tenantId, table.userId],
            foreignColumns: [user.tenantId, user.id],
        }),
        uniqueIndex("credential_tenant_user_unique_idx").on(
            table.tenantId,
            table.userId,
        ),
        index("credential_tenant_user_idx").on(table.tenantId, table.userId),
    ],
);

export const role = pgTable(
    "role",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        userId: uuid("user_id").notNull(),
        name: text("name").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check("role_name_check", sql`${table.name} in (${roleValueCheckSql})`),
        foreignKey({
            name: "role_user_tenant_fk",
            // Tenant joins prevent roles from attaching to another tenant's user.
            columns: [table.tenantId, table.userId],
            foreignColumns: [user.tenantId, user.id],
        }),
        uniqueIndex("role_tenant_user_name_unique_idx").on(
            table.tenantId,
            table.userId,
            table.name,
        ),
        index("role_tenant_name_idx").on(table.tenantId, table.name),
        index("role_tenant_user_idx").on(table.tenantId, table.userId),
    ],
);

export const refreshToken = pgTable(
    "refresh_token",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        tenantId: uuid("tenant_id").notNull(),
        userId: uuid("user_id").notNull(),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            "refresh_token_token_hash_not_blank_check",
            sql`nullif(btrim(${table.tokenHash}), '') is not null`,
        ),
        foreignKey({
            name: "refresh_token_user_tenant_fk",
            // Tenant joins prevent refresh tokens from attaching to another tenant's user.
            columns: [table.tenantId, table.userId],
            foreignColumns: [user.tenantId, user.id],
        }),
        index("refresh_token_tenant_user_idx").on(table.tenantId, table.userId),
        index("refresh_token_tenant_expires_at_idx").on(
            table.tenantId,
            table.expiresAt,
        ),
    ],
);

export type User = InferSelectModel<typeof user>;
export type NewUser = InferInsertModel<typeof user>;
export type Credential = InferSelectModel<typeof credential>;
export type NewCredential = InferInsertModel<typeof credential>;
export type Role = InferSelectModel<typeof role>;
export type NewRole = InferInsertModel<typeof role>;
export type RefreshToken = InferSelectModel<typeof refreshToken>;
export type NewRefreshToken = InferInsertModel<typeof refreshToken>;
