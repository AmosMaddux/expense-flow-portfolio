import { describe, expect, test } from "vitest";

import { getNavigationItemsForRole, type RoleName } from "./navigation";

const financeAdminNavigationLabels = [
    "Finance Dashboard",
    "Expense Reports",
    "All Transactions",
    "Approval Queue",
    "Policy Reference",
    "GL Mapping",
    "Team & Users",
];

const departmentManagerNavigationLabels = [
    "Expense Reports",
    "Approval Queue",
    "Policy Reference",
    "GL Mapping",
];

function labelsForRole(role: RoleName): string[] {
    return getNavigationItemsForRole(role).map((item) => item.label);
}

describe("sidebar navigation", () => {
    test("renders Finance Admin navigation including Team & Users", () => {
        expect(labelsForRole("Finance Admin")).toStrictEqual(
            financeAdminNavigationLabels,
        );
    });

    test("renders Department Manager navigation without user management", () => {
        expect(labelsForRole("Department Manager")).toStrictEqual(
            departmentManagerNavigationLabels,
        );
    });

    test("renders Employee portal navigation items", () => {
        expect(labelsForRole("Employee")).toStrictEqual([
            "My Submissions",
            "Submit Expense",
            "Log Mileage",
        ]);
    });

    test("renders Platform Admin navigation items for the Admin role", () => {
        expect(labelsForRole("Admin")).toStrictEqual([
            "Roles & Permissions",
            "All Tenants & Users",
            "Audit Log",
        ]);
    });
});
