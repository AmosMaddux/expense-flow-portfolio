import { useMemo } from "react";

export const EXPENSE_REPORT_STAGES = [
    "Drafted",
    "Submitted",
    "Manager Approval",
    "AP Review",
    "Paid",
    "Reconciled",
] as const;

export type ExpenseReportStage = (typeof EXPENSE_REPORT_STAGES)[number];
export type StageStepState = "done" | "current" | "upcoming";

export interface UseStageStepperInput {
    currentStage: ExpenseReportStage;
    onHold?: boolean;
}

export interface StageStepperItem {
    isPaused: boolean;
    stage: ExpenseReportStage;
    state: StageStepState;
}

export interface ValidStageStepperResult {
    status: "valid";
    steps: readonly StageStepperItem[];
}

export interface InvalidStageStepperResult {
    status: "invalid";
    steps: readonly [];
}

export type UseStageStepperResult =
    ValidStageStepperResult | InvalidStageStepperResult;

/**
 * Derives the six visual step states from an Expense Report's current state.
 */
export function useStageStepper({
    currentStage,
    onHold = false,
}: UseStageStepperInput): UseStageStepperResult {
    return useMemo<UseStageStepperResult>(() => {
        const currentStageIndex = EXPENSE_REPORT_STAGES.indexOf(currentStage);

        if (currentStageIndex === -1) {
            return {
                status: "invalid",
                steps: [],
            };
        }

        return {
            status: "valid",
            steps: EXPENSE_REPORT_STAGES.map((stage, index) => ({
                isPaused: onHold && index === currentStageIndex,
                stage,
                state: getStageState(index, currentStageIndex),
            })),
        };
    }, [currentStage, onHold]);
}

function getStageState(
    stageIndex: number,
    currentStageIndex: number,
): StageStepState {
    if (stageIndex < currentStageIndex) {
        return "done";
    }

    if (stageIndex === currentStageIndex) {
        return "current";
    }

    return "upcoming";
}
