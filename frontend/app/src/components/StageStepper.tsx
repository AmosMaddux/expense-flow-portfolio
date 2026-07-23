import type { HTMLAttributes } from "react";

import { useStageStepper } from "../hooks/useStageStepper";
import type { ExpenseReportStage } from "../hooks/useStageStepper";

export { EXPENSE_REPORT_STAGES } from "../hooks/useStageStepper";
export type { ExpenseReportStage } from "../hooks/useStageStepper";

export interface StageStepperProps extends HTMLAttributes<HTMLOListElement> {
    currentStage: ExpenseReportStage;
    onHold?: boolean;
}

/**
 * Renders the six Expense Report stages from the stage-stepper hook state.
 */
export function StageStepper({
    className,
    currentStage,
    onHold = false,
    ...stepperProps
}: StageStepperProps): JSX.Element {
    const classes = ["ef-stage-stepper", className].filter(Boolean).join(" ");
    const stepperState = useStageStepper({ currentStage, onHold });

    if (stepperState.status === "invalid") {
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

    const { steps } = stepperState;

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
                        data-state={state}
                        key={stage}
                    >
                        <span className="ef-stage-stepper__marker">
                            {index + 1}
                        </span>
                        <span className="ef-stage-stepper__label">{stage}</span>
                        {isPaused ? (
                            <span
                                className="ef-stage-stepper__paused"
                                role="status"
                            >
                                Paused
                            </span>
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}
