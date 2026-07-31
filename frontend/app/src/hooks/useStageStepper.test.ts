import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
    EXPENSE_REPORT_STAGES,
    useStageStepper,
    type ExpenseReportStage,
    type StageStepState,
} from ".";

const expectedStatesByStage: Record<
    ExpenseReportStage,
    readonly StageStepState[]
> = {
    Drafted: [
        "current",
        "upcoming",
        "upcoming",
        "upcoming",
        "upcoming",
        "upcoming",
    ],
    Submitted: [
        "done",
        "current",
        "upcoming",
        "upcoming",
        "upcoming",
        "upcoming",
    ],
    "Manager Approval": [
        "done",
        "done",
        "current",
        "upcoming",
        "upcoming",
        "upcoming",
    ],
    "AP Review": ["done", "done", "done", "current", "upcoming", "upcoming"],
    Paid: ["done", "done", "done", "done", "current", "upcoming"],
    Reconciled: ["done", "done", "done", "done", "done", "current"],
};

describe("useStageStepper", () => {
    test.each(EXPENSE_REPORT_STAGES)(
        "derives all six step states for %s",
        (currentStage) => {
            const { result } = renderHook(() =>
                useStageStepper({ currentStage }),
            );

            expect(result.current.status).toBe("valid");

            if (result.current.status !== "valid") {
                throw new Error("Expected a valid stage-stepper result.");
            }

            expect(result.current.steps.map((step) => step.stage)).toEqual(
                EXPENSE_REPORT_STAGES,
            );
            expect(result.current.steps.map((step) => step.state)).toEqual(
                expectedStatesByStage[currentStage],
            );
            expect(result.current.steps.every((step) => !step.isPaused)).toBe(
                true,
            );
        },
    );

    test("marks an on-hold case as paused without changing its stage position", () => {
        const { result } = renderHook(() =>
            useStageStepper({
                currentStage: "AP Review",
                onHold: true,
            }),
        );

        expect(result.current.status).toBe("valid");

        if (result.current.status !== "valid") {
            throw new Error("Expected a valid stage-stepper result.");
        }

        expect(result.current.steps.map((step) => step.state)).toEqual(
            expectedStatesByStage["AP Review"],
        );
        expect(result.current.steps.map((step) => step.isPaused)).toEqual([
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
    });

    test("returns an explicit invalid result for an unknown stage", () => {
        const { result } = renderHook(() =>
            useStageStepper({
                currentStage: "Archived" as ExpenseReportStage,
            }),
        );

        expect(result.current).toEqual({
            status: "invalid",
            steps: [],
        });
    });
});
