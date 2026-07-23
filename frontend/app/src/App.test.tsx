import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { AppShell } from "./App";

afterEach(() => {
    cleanup();
});

describe("AppShell", () => {
    test("renders Department Manager navigation without Team & Users", () => {
        render(
            <AppShell
                currentPath="/approval-queue"
                signedInRole="Department Manager"
            />,
        );

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        const approvalQueueLink = within(sidebar).getByRole("link", {
            name: "Approval Queue",
        });

        expect(within(sidebar).getByText("Finance Dashboard")).not.toBeNull();
        expect(within(sidebar).getByText("GL Mapping")).not.toBeNull();
        expect(within(sidebar).queryByText("Team & Users")).toBeNull();
        expect(approvalQueueLink.getAttribute("href")).toBe("/approval-queue");
        expect(approvalQueueLink.getAttribute("aria-current")).toBe("page");
    });

    test("renders Employee navigation links only for the employee portal", () => {
        render(<AppShell currentPath="/log-mileage" signedInRole="Employee" />);

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        const mileageLink = within(sidebar).getByRole("link", {
            name: "Log Mileage",
        });

        expect(within(sidebar).getByText("My Submissions")).not.toBeNull();
        expect(within(sidebar).getByText("Submit Expense")).not.toBeNull();
        expect(within(sidebar).queryByText("Finance Dashboard")).toBeNull();
        expect(mileageLink.getAttribute("href")).toBe("/log-mileage");
        expect(mileageLink.getAttribute("aria-current")).toBe("page");
    });
});
