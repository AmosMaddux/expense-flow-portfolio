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
}

/**
 * Renders the Expense Report workflow stages with current progress.
 */
export function StageStepper({
    className,
    currentStage,
    ...stepperProps
}: StageStepperProps): JSX.Element {
    const currentStageIndex = EXPENSE_REPORT_STAGES.indexOf(currentStage);
    const classes = ["ef-stage-stepper", className].filter(Boolean).join(" ");

    if (currentStageIndex === -1) {
        return (
            <ol
                aria-label="Expense Report stage progress"
                className={`${classes} ef-stage-stepper--invalid`}
                {...stepperProps}
            >
                <li className="ef-stage-stepper__item ef-stage-stepper__item--invalid">
                    <span className="ef-stage-stepper__marker">!</span>
                    <span className="ef-stage-stepper__label">
                        Unknown workflow stage
                    </span>
                </li>
            </ol>
        );
    }

    return (
        <ol
            aria-label="Expense Report stage progress"
            className={classes}
            {...stepperProps}
        >
            {EXPENSE_REPORT_STAGES.map((stage, index) => {
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
