import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { AppShell } from "./App";

afterEach(() => {
    cleanup();
});

describe("AppShell", () => {
    test("renders Department Manager navigation with Team & Users", () => {
        render(<AppShell signedInRole="Department Manager" />);

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });

        expect(within(sidebar).getByText("Finance Dashboard")).not.toBeNull();
        expect(within(sidebar).getByText("GL Mapping")).not.toBeNull();
        expect(within(sidebar).getByText("Team & Users")).not.toBeNull();
    });

    test("renders Employee navigation only for the employee portal", () => {
        render(<AppShell signedInRole="Employee" />);

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });

        expect(within(sidebar).getByText("My Submissions")).not.toBeNull();
        expect(within(sidebar).getByText("Submit Expense")).not.toBeNull();
        expect(within(sidebar).getByText("Log Mileage")).not.toBeNull();
        expect(within(sidebar).queryByText("Finance Dashboard")).toBeNull();
    });
});

