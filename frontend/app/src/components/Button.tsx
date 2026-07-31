import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    size?: ButtonSize;
    variant?: ButtonVariant;
}

/**
 * Renders a typed ExpenseFlow button primitive with shared variants.
 */
export function Button({
    children,
    className,
    size = "md",
    type = "button",
    variant = "primary",
    ...buttonProps
}: ButtonProps): JSX.Element {
    const classes = [
        "ef-button",
        `ef-button--${variant}`,
        `ef-button--${size}`,
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button className={classes} type={type} {...buttonProps}>
            {children}
        </button>
    );
}
