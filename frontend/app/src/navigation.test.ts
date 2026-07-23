import { describe, expect, test } from "vitest";

import { getNavigationItemsForRole, type RoleName } from "./navigation";

const internalNavigationLabels = [
    "Finance Dashboard",
    "Expense Reports",
    "All Transactions",
    "Approval Queue",
    "Receipts",
    "Policy Reference",
    "GL Mapping",
    "Team & Users",
];

function labelsForRole(role: RoleName): string[] {
    return getNavigationItemsForRole(role).map((item) => item.label);
}

describe("sidebar navigation", () => {
    test("renders all internal navigation items for Finance Admin", () => {
        expect(labelsForRole("Finance Admin")).toStrictEqual(
            internalNavigationLabels,
        );
    });

    test("renders all internal navigation items for Department Manager", () => {
        expect(labelsForRole("Department Manager")).toStrictEqual(
            internalNavigationLabels,
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
