import { roleValues, type RoleName } from "../db/schema/identityAuth.js";

/**
 * One tenant-scoped screen an ExpenseFlow role may reach, keyed to the same
 * paths declared in the SPA's navigation config. This table only drives the
 * read-only Roles & Permissions display matrix — it does not enforce
 * anything itself. Real access is enforced independently by each route's own
 * role check (e.g. `requireFinanceAdminTeamUserAccess`,
 * `requirePlatformAdminAccess`). Editing `allowedRoles` here changes what the
 * matrix displays, not what the API allows; keep it in sync by hand, and see
 * `screenAccessPolicy.enforcement.test.ts` for the entries that are checked
 * against their controller's actual role gate.
 */
export type ScreenAccessEntry = {
    key: string;
    label: string;
    allowedRoles: readonly RoleName[];
};

export const screenAccessPolicy: readonly ScreenAccessEntry[] = [
    {
        key: "finance-dashboard",
        label: "Finance Dashboard",
        allowedRoles: ["Finance Admin"],
    },
    {
        key: "expense-reports",
        label: "Expense Reports",
        allowedRoles: ["Finance Admin"],
    },
    {
        key: "transactions",
        label: "All Transactions",
        allowedRoles: ["Finance Admin"],
    },
    {
        key: "approval-queue",
        label: "Approval Queue",
        allowedRoles: ["Finance Admin", "Department Manager"],
    },
    {
        key: "policy-reference",
        label: "Policy Reference",
        allowedRoles: ["Finance Admin", "Department Manager"],
    },
    {
        key: "gl-mapping",
        label: "GL Mapping",
        allowedRoles: ["Finance Admin", "Department Manager"],
    },
    {
        key: "team-users",
        label: "Team & Users",
        allowedRoles: ["Finance Admin"],
    },
    {
        key: "my-submissions",
        label: "My Submissions",
        allowedRoles: ["Employee"],
    },
    {
        key: "submit-expense",
        label: "Submit Expense",
        allowedRoles: ["Employee"],
    },
    {
        key: "log-mileage",
        label: "Log Mileage",
        allowedRoles: ["Employee"],
    },
    {
        key: "roles-permissions",
        label: "Roles & Permissions",
        allowedRoles: ["Admin"],
    },
    {
        key: "tenants-users",
        label: "All Tenants & Users",
        allowedRoles: ["Admin"],
    },
    {
        key: "audit-log",
        label: "Audit Log",
        allowedRoles: ["Admin"],
    },
] as const;

export type RolePermissionMatrixRole = {
    role: RoleName;
    screens: Record<string, boolean>;
};

export type RolePermissionMatrix = {
    screens: readonly { key: string; label: string }[];
    roles: readonly RolePermissionMatrixRole[];
};

/**
 * Builds the read-only role-to-screen-access matrix shown on the Platform
 * Admin Roles & Permissions screen.
 */
export function buildRolePermissionMatrix(): RolePermissionMatrix {
    return {
        screens: screenAccessPolicy.map(({ key, label }) => ({ key, label })),
        roles: roleValues.map((role) => ({
            role,
            screens: Object.fromEntries(
                screenAccessPolicy.map((screen) => [
                    screen.key,
                    screen.allowedRoles.includes(role),
                ]),
            ),
        })),
    };
}
