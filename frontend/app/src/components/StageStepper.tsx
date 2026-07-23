import type { HTMLAttributes } from "react";

import {
    EXPENSE_REPORT_STAGES,
    useStageStepper,
    type ExpenseReportStage,
} from "../hooks/useStageStepper";

export { EXPENSE_REPORT_STAGES, type ExpenseReportStage };

export interface StageStepperProps extends HTMLAttributes<HTMLOListElement> {
    currentStage: ExpenseReportStage;
    onHold?: boolean;
}

/**
 * Renders the Expense Report workflow stages with current progress.
 */
export function StageStepper({
    className,
    currentStage,
    onHold = false,
    ...stepperProps
}: StageStepperProps): JSX.Element {
    const classes = ["ef-stage-stepper", className].filter(Boolean).join(" ");
    const steps = useStageStepper({ currentStage, onHold });

    return (
        <ol
            aria-label="Expense Report stage progress"
            className={classes}
            {...stepperProps}
        >
            {steps.map(({ isPaused, stage, state }, index) => {
                const itemClasses = [
                    "ef-stage-stepper__item",
                    `ef-stage-stepper__item--${state}`,
                    isPaused ? "ef-stage-stepper__item--paused" : undefined,
                ]
                    .filter(Boolean)
                    .join(" ");

                return (
                    <li
                        aria-current={state === "current" ? "step" : undefined}
                        className={itemClasses}
                        key={stage}
                    >
                        <span className="ef-stage-stepper__marker">
                            {index + 1}
                        </span>
                        <span className="ef-stage-stepper__label">{stage}</span>
                        {isPaused ? (
                            <span className="ef-stage-stepper__paused">
                                Paused
                            </span>
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}
