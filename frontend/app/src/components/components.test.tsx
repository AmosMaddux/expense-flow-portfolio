import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    Badge,
    Button,
    EXPENSE_REPORT_STAGES,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
    OverdueBadge,
    StageStepper,
    StatusBadge,
    type ExpenseReportStage,
} from ".";

afterEach(() => {
    cleanup();
});

describe("shared component primitives", () => {
    test("button defaults to a safe type and applies variant and size classes", () => {
        const { getByRole } = render(
            <Button size="lg" variant="danger" disabled>
                Reject
            </Button>,
        );

        const button = getByRole("button", { name: "Reject" });

        expect(button.getAttribute("type")).toBe("button");
        expect(button.className).toContain("ef-button--danger");
        expect(button.className).toContain("ef-button--lg");
        expect(button.hasAttribute("disabled")).toBe(true);
    });

    test("badge primitives apply the requested tones", () => {
        const { getByText } = render(
            <div>
                <Badge tone="warning">Needs receipt</Badge>
                <StatusBadge label="Manager Approval" tone="info" />
            </div>,
        );

        expect(getByText("Needs receipt").className).toContain(
            "ef-badge--warning",
        );
        expect(getByText("Manager Approval").className).toContain(
            "ef-badge--info",
        );
    });

    test("overdue badge renders overdue and on-track states with expected tones", () => {
        const { getByText } = render(
            <div>
                <OverdueBadge isOverdue />
                <OverdueBadge isOverdue={false} />
            </div>,
        );

        expect(getByText("Overdue").className).toContain("ef-badge--danger");
        expect(getByText("On track").className).toContain("ef-badge--success");
    });

    test("stage stepper preserves the canonical stage order", () => {
        const { getAllByRole } = render(
            <StageStepper currentStage="Manager Approval" />,
        );

        expect(
            getAllByRole("listitem").map((stage) => stage.textContent),
        ).toEqual(
            EXPENSE_REPORT_STAGES.map((stage, index) => `${index + 1}${stage}`),
        );
    });

    test("stage stepper marks exactly one current stage", () => {
        const { getAllByRole } = render(
            <StageStepper currentStage="AP Review" />,
        );

        const stages = getAllByRole("listitem");
        const currentStages = stages.filter(
            (stage) => stage.getAttribute("aria-current") === "step",
        );

        expect(currentStages).toHaveLength(1);
        expect(currentStages[0]?.textContent).toBe("4AP Review");
    });

    test("stage stepper marks stages before current as complete and after as upcoming", () => {
        const { getAllByRole } = render(
            <StageStepper currentStage="AP Review" />,
        );

        const stages = getAllByRole("listitem");

        expect(stages[0]?.className).toContain("ef-stage-stepper__item--done");
        expect(stages[1]?.className).toContain("ef-stage-stepper__item--done");
        expect(stages[2]?.className).toContain("ef-stage-stepper__item--done");
        expect(stages[3]?.className).toContain(
            "ef-stage-stepper__item--current",
        );
        expect(stages[4]?.className).toContain(
            "ef-stage-stepper__item--upcoming",
        );
        expect(stages[5]?.className).toContain(
            "ef-stage-stepper__item--upcoming",
        );
    });

    test("stage stepper renders an explicit fallback for an unknown current stage", () => {
        const { getByRole, queryByText } = render(
            <StageStepper currentStage={"Archived" as ExpenseReportStage} />,
        );

        const fallback = getByRole("listitem");

        expect(fallback.textContent).toBe("!Unknown workflow stage");
        expect(fallback.className).toContain("ef-stage-stepper__item--invalid");
        expect(fallback.hasAttribute("aria-current")).toBe(false);
        expect(queryByText("Archived")).toBeNull();
    });

    test("renders a paused indicator on the current stage for on-hold cases", () => {
        const { getAllByRole, getByText } = render(
            <StageStepper currentStage="Manager Approval" onHold />,
        );

        const stages = getAllByRole("listitem");

        expect(stages).toHaveLength(6);
        expect(stages[2]?.getAttribute("aria-current")).toBe("step");
        expect(stages[2]?.className).toContain(
            "ef-stage-stepper__item--paused",
        );
        expect(getByText("Paused")).toBeTruthy();
    });

    test("loading skeleton exposes an accessible loading status", () => {
        const { getByRole } = render(
            <LoadingSkeleton label="Loading Case Queue" />,
        );

        expect(getByRole("status").getAttribute("aria-label")).toBe(
            "Loading Case Queue",
        );
    });

    test("empty state renders the provided title, body, and action", () => {
        const { getByRole, getByText } = render(
            <EmptyState
                action={<Button>Refresh</Button>}
                body="No Expense Reports need review."
                title="No reports waiting"
            />,
        );

        expect(getByRole("region", { name: "No reports waiting" })).toBeTruthy();
        expect(getByText("No Expense Reports need review.")).toBeTruthy();
        expect(getByRole("button", { name: "Refresh" })).toBeTruthy();
    });

    test("error state invokes retry when the retry action is clicked", () => {
        const onRetry = vi.fn();
        const { getByRole, getByText } = render(
            <ErrorState
                message="Synthetic Case Queue failure."
                onRetry={onRetry}
                title="Unable to load Case Queue"
            />,
        );

        getByRole("button", { name: "Retry" }).click();

        expect(
            getByRole("heading", { name: "Unable to load Case Queue" }),
        ).toBeTruthy();
        expect(getByText("Synthetic Case Queue failure.")).toBeTruthy();
        expect(onRetry).toHaveBeenCalledOnce();
    });

    test("error state has reusable default copy and disables retry while retrying", () => {
        const { getByRole } = render(
            <ErrorState
                isRetrying
                message="Synthetic workspace failure."
                onRetry={vi.fn()}
            />,
        );

        expect(
            getByRole("heading", { name: "Unable to load data" }),
        ).toBeTruthy();
        expect(
            getByRole("button", { name: "Retrying..." }).hasAttribute(
                "disabled",
            ),
        ).toBe(true);
    });
});
