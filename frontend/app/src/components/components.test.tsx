import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { Badge, Button, OverdueBadge, StageStepper, StatusBadge } from ".";

afterEach(() => {
    cleanup();
});

describe("shared component primitives", () => {
    test("renders buttons, badges, and the stage stepper without errors", () => {
        const { getAllByText, getByRole, getByText } = render(
            <div>
                <Button>Approve</Button>
                <Badge>Drafted</Badge>
                <StatusBadge label="Manager Approval" tone="info" />
                <OverdueBadge isOverdue />
                <StageStepper currentStage="AP Review" />
            </div>,
        );

        expect(getByRole("button", { name: "Approve" })).toBeTruthy();
        expect(getAllByText("Drafted").length).toBeGreaterThan(0);
        expect(getAllByText("Manager Approval").length).toBeGreaterThan(0);
        expect(getByText("Overdue")).toBeTruthy();
        expect(
            getByRole("list", { name: "Expense Report stage progress" }),
        ).toBeTruthy();
    });
});
