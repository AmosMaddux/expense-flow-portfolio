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
    stages?: readonly ExpenseReportStage[];
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
    stages = EXPENSE_REPORT_STAGES,
}: UseStageStepperInput): UseStageStepperResult {
    return useMemo(() => {
        const currentStageIndex = stages.indexOf(currentStage);

        return stages.map((stage, index) => ({
            isPaused: onHold && index === currentStageIndex,
            stage,
            state: getStageState(index, currentStageIndex),
        }));
    }, [currentStage, onHold, stages]);
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
