import type { HTMLAttributes } from "react";

export const EXPENSE_REPORT_STAGES = [
    "Drafted",
    "Submitted",
    "Manager Approval",
    "AP Review",
    "Paid",
    "Reconciled",
] as const;

export type ExpenseReportStage = (typeof EXPENSE_REPORT_STAGES)[number];

export interface StageStepperProps extends HTMLAttributes<HTMLOListElement> {
    currentStage: ExpenseReportStage;
    stages?: readonly ExpenseReportStage[];
}

/**
 * Renders the Expense Report workflow stages with current progress.
 */
export function StageStepper({
    className,
    currentStage,
    stages = EXPENSE_REPORT_STAGES,
    ...stepperProps
}: StageStepperProps): JSX.Element {
    const currentStageIndex = stages.indexOf(currentStage);
    const classes = ["ef-stage-stepper", className].filter(Boolean).join(" ");

    return (
        <ol
            aria-label="Expense Report stage progress"
            className={classes}
            {...stepperProps}
        >
            {stages.map((stage, index) => {
                const state = getStageState(index, currentStageIndex);

                return (
                    <li
                        aria-current={state === "current" ? "step" : undefined}
                        className={`ef-stage-stepper__item ef-stage-stepper__item--${state}`}
                        key={stage}
                    >
                        <span className="ef-stage-stepper__marker">
                            {index + 1}
                        </span>
                        <span className="ef-stage-stepper__label">{stage}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function getStageState(
    stageIndex: number,
    currentStageIndex: number,
): "complete" | "current" | "upcoming" {
    if (stageIndex < currentStageIndex) {
        return "complete";
    }

    if (stageIndex === currentStageIndex) {
        return "current";
    }

    return "upcoming";
}
