import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { EXPENSE_REPORT_STAGES, StageStepper } from ".";
import {
    useStageStepper,
    type StageStepperItem,
    type UseStageStepperResult,
} from "../hooks/useStageStepper";

vi.mock("../hooks/useStageStepper", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../hooks/useStageStepper")>();

    return {
        ...actual,
        useStageStepper: vi.fn(actual.useStageStepper),
    };
});

afterEach(() => {
    cleanup();
    vi.mocked(useStageStepper).mockClear();
});

describe("StageStepper", () => {
    test("renders the step states returned by useStageStepper", () => {
        const mockedSteps = EXPENSE_REPORT_STAGES.map((stage) => ({
            isPaused: stage === "Reconciled",
            stage,
            state: stage === "Reconciled" ? "current" : "upcoming",
        })) satisfies readonly StageStepperItem[];
        const mockedResult = {
            status: "valid",
            steps: mockedSteps,
        } satisfies UseStageStepperResult;

        vi.mocked(useStageStepper).mockReturnValueOnce(mockedResult);

        const { getAllByRole, getByRole } = render(
            <StageStepper currentStage="Drafted" />,
        );
        const steps = getAllByRole("listitem");

        expect(useStageStepper).toHaveBeenCalledWith({
            currentStage: "Drafted",
            onHold: false,
        });
        expect(steps.map((step) => step.dataset.state)).toEqual(
            mockedSteps.map((step) => step.state),
        );
        expect(steps[0]?.hasAttribute("aria-current")).toBe(false);
        expect(steps[5]?.getAttribute("aria-current")).toBe("step");
        expect(steps[5]?.className).toContain("ef-stage-stepper__item--paused");
        expect(getByRole("status").textContent).toBe("Paused");
    });

    test("renders the invalid state returned by useStageStepper", () => {
        vi.mocked(useStageStepper).mockReturnValueOnce({
            status: "invalid",
            steps: [],
        });

        const { getByRole } = render(<StageStepper currentStage="Drafted" />);

        expect(getByRole("listitem").textContent).toBe(
            "!Unknown workflow stage",
        );
    });

    test.each(EXPENSE_REPORT_STAGES)(
        "renders hook-derived progress for %s",
        (currentStage) => {
            const { getAllByRole } = render(
                <StageStepper currentStage={currentStage} />,
            );
            const steps = getAllByRole("listitem");
            const currentStageIndex =
                EXPENSE_REPORT_STAGES.indexOf(currentStage);

            expect(steps).toHaveLength(6);
            expect(steps.map((step) => step.textContent)).toEqual(
                EXPENSE_REPORT_STAGES.map(
                    (stage, index) => `${index + 1}${stage}`,
                ),
            );
            expect(steps.map((step) => step.dataset.state)).toEqual(
                EXPENSE_REPORT_STAGES.map((_, index) => {
                    if (index < currentStageIndex) {
                        return "done";
                    }

                    return index === currentStageIndex ? "current" : "upcoming";
                }),
            );
            expect(
                steps.filter(
                    (step) => step.getAttribute("aria-current") === "step",
                ),
            ).toEqual([steps[currentStageIndex]]);
        },
    );

    test("shows the on-hold indicator on the current stage", () => {
        const { getAllByRole, getByRole } = render(
            <StageStepper currentStage="Manager Approval" onHold />,
        );
        const steps = getAllByRole("listitem");

        expect(getByRole("status").textContent).toBe("Paused");
        expect(steps[2]?.className).toContain("ef-stage-stepper__item--paused");
        expect(
            steps.filter((step) =>
                step.className.includes("ef-stage-stepper__item--paused"),
            ),
        ).toHaveLength(1);
    });

    test("resets progress when a review sends the case back to Drafted", () => {
        const { getAllByRole, rerender } = render(
            <StageStepper currentStage="AP Review" />,
        );

        expect(
            getAllByRole("listitem").map((step) => step.dataset.state),
        ).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"]);

        rerender(<StageStepper currentStage="Drafted" />);

        const resetSteps = getAllByRole("listitem");

        expect(resetSteps.map((step) => step.dataset.state)).toEqual([
            "current",
            "upcoming",
            "upcoming",
            "upcoming",
            "upcoming",
            "upcoming",
        ]);
        expect(resetSteps[0]?.getAttribute("aria-current")).toBe("step");
        expect(
            resetSteps
                .slice(1)
                .every((step) => !step.hasAttribute("aria-current")),
        ).toBe(true);
    });
});
