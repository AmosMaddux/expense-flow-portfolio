import type { Role } from "./auth";

export const roleNames = [
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
] as const satisfies readonly Role[];

export type RoleName = Role;

export type NavigationItem = {
    label: string;
    path: string;
    allowedRoles: readonly RoleName[];
};

const internalRoles = ["Finance Admin", "Department Manager"] as const;
const financeAdminOnlyRoles = ["Finance Admin"] as const;

export const navigationItems = [
    {
        label: "Finance Dashboard",
        path: "/finance-dashboard",
        allowedRoles: financeAdminOnlyRoles,
    },
    {
        label: "Expense Reports",
        path: "/expense-reports",
        allowedRoles: internalRoles,
    },
    {
        label: "All Transactions",
        path: "/transactions",
        allowedRoles: internalRoles,
    },
    {
        label: "Approval Queue",
        path: "/approval-queue",
        allowedRoles: internalRoles,
    },
    {
        label: "Receipts",
        path: "/receipts",
        allowedRoles: internalRoles,
    },
    {
        label: "Policy Reference",
        path: "/policy-reference",
        allowedRoles: internalRoles,
    },
    {
        label: "GL Mapping",
        path: "/gl-mapping",
        allowedRoles: internalRoles,
    },
    {
        label: "Team & Users",
        path: "/team-users",
        allowedRoles: financeAdminOnlyRoles,
    },
    {
        label: "My Submissions",
        path: "/my-submissions",
        allowedRoles: ["Employee"],
    },
    {
        label: "Submit Expense",
        path: "/submit-expense",
        allowedRoles: ["Employee"],
    },
    {
        label: "Log Mileage",
        path: "/log-mileage",
        allowedRoles: ["Employee"],
    },
    {
        label: "Roles & Permissions",
        path: "/roles-permissions",
        allowedRoles: ["Admin"],
    },
    {
        label: "All Tenants & Users",
        path: "/tenants-users",
        allowedRoles: ["Admin"],
    },
    {
        label: "Audit Log",
        path: "/audit-log",
        allowedRoles: ["Admin"],
    },
] as const satisfies readonly NavigationItem[];

/**
 * Returns the sidebar entries visible to the authenticated user's role.
 */
export function getNavigationItemsForRole(role: RoleName): NavigationItem[] {
    return getNavigationItemsForRoles([role]);
}

/**
 * Returns the sidebar entries visible to any authenticated user role.
 */
export function getNavigationItemsForRoles(
    roles: readonly RoleName[],
): NavigationItem[] {
    return navigationItems.filter((item) =>
        item.allowedRoles.some((allowedRole) => roles.includes(allowedRole)),
    );
}
