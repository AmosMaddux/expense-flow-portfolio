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

export type UseStageStepperResult = readonly StageStepperItem[];

/**
 * Derives display states for the Expense Report stage stepper.
 */
export function useStageStepper({
    currentStage,
    onHold = false,
}: UseStageStepperInput): UseStageStepperResult {
    return useMemo(() => {
        const currentStageIndex = EXPENSE_REPORT_STAGES.indexOf(currentStage);

        return EXPENSE_REPORT_STAGES.map((stage, index) => ({
            isPaused: onHold && index === currentStageIndex,
            stage,
            state: getStageState(index, currentStageIndex),
        }));
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
