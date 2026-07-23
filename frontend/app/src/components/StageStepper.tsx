import type { HTMLAttributes } from "react";

import {
    EXPENSE_REPORT_STAGES,
    useStageStepper,
    type ExpenseReportStage,
} from "../hooks";
import "./StageStepper.css";

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
    const steps = useStageStepper({ currentStage, onHold });
    const classes = ["ef-stage-stepper", className].filter(Boolean).join(" ");

    return (
        <ol
            aria-label="Expense Report stage progress"
            className={classes}
            {...stepperProps}
        >
            {steps.map(({ isOnHold, stage, state }, index) => {
                const itemClasses = [
                    "ef-stage-stepper__item",
                    `ef-stage-stepper__item--${state}`,
                    isOnHold ? "ef-stage-stepper__item--on-hold" : undefined,
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
                        <span
                            aria-hidden="true"
                            className="ef-stage-stepper__marker"
                        >
                            {index + 1}
                        </span>
                        <span className="ef-stage-stepper__label">{stage}</span>
                        {isOnHold ? (
                            <span
                                className="ef-stage-stepper__on-hold"
                                role="status"
                            >
                                On hold
                            </span>
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}

export { EXPENSE_REPORT_STAGES, type ExpenseReportStage };
