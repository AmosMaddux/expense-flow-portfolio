import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    children: ReactNode;
    tone?: BadgeTone;
}

export interface StatusBadgeProps extends Omit<
    BadgeProps,
    "children" | "tone"
> {
    label: string;
    tone?: BadgeTone;
}

export interface OverdueBadgeProps extends Omit<
    BadgeProps,
    "children" | "tone"
> {
    isOverdue: boolean;
}

/**
 * Renders a compact status label with a shared visual tone.
 */
export function Badge({
    children,
    className,
    tone = "neutral",
    ...badgeProps
}: BadgeProps): JSX.Element {
    const classes = ["ef-badge", `ef-badge--${tone}`, className]
        .filter(Boolean)
        .join(" ");

    return (
        <span className={classes} {...badgeProps}>
            {children}
        </span>
    );
}

/**
 * Renders a named case or task status badge.
 */
export function StatusBadge({
    label,
    tone = "neutral",
    ...badgeProps
}: StatusBadgeProps): JSX.Element {
    return (
        <Badge tone={tone} {...badgeProps}>
            {label}
        </Badge>
    );
}

/**
 * Renders the due-date badge used by queue and case-detail surfaces.
 */
export function OverdueBadge({
    isOverdue,
    ...badgeProps
}: OverdueBadgeProps): JSX.Element {
    return (
        <Badge tone={isOverdue ? "danger" : "success"} {...badgeProps}>
            {isOverdue ? "Overdue" : "On track"}
        </Badge>
    );
}
