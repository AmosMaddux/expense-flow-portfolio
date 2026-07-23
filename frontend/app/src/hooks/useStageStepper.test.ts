import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { EXPENSE_REPORT_STAGES, type ExpenseReportStage } from "../components";
import { useStageStepper, type StageStepState } from "./useStageStepper";

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
        "derives step states when the current stage is %s",
        (currentStage) => {
            const { result } = renderHook(() =>
                useStageStepper({ currentStage }),
            );

            expect(result.current.map((step) => step.stage)).toEqual(
                EXPENSE_REPORT_STAGES,
            );
            expect(result.current.map((step) => step.state)).toEqual(
                expectedStatesByStage[currentStage],
            );
            expect(result.current.every((step) => !step.isPaused)).toBe(true);
        },
    );

    test("marks an on-hold case as paused without changing its stage position", () => {
        const { result } = renderHook(() =>
            useStageStepper({
                currentStage: "AP Review",
                onHold: true,
            }),
        );

        expect(result.current.map((step) => step.state)).toEqual(
            expectedStatesByStage["AP Review"],
        );
        expect(result.current.map((step) => step.isPaused)).toEqual([
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
    });
});
