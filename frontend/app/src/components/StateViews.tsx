import type { ReactNode } from "react";

import { Button } from "./Button";

export type LoadingSkeletonProps = {
    label: string;
    rows?: number;
};

export type EmptyStateProps = {
    action?: ReactNode;
    body: string;
    title: string;
};

export type ErrorStateProps = {
    isRetrying?: boolean;
    message: string;
    onRetry: () => void;
    title?: string;
};

/**
 * Renders shared loading skeleton blocks for data-dense workspace regions.
 */
export function LoadingSkeleton({
    label,
    rows = 4,
}: LoadingSkeletonProps): JSX.Element {
    return (
        <div
            aria-label={label}
            aria-live="polite"
            className="ef-state ef-state--loading"
            role="status"
        >
            <span className="ef-state__sr">{label}</span>
            <div className="ef-skeleton-grid" aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                    <span className="ef-skeleton-card" key={index} />
                ))}
            </div>
            <div className="ef-skeleton-table" aria-hidden="true">
                {Array.from({ length: rows }, (_, index) => (
                    <span className="ef-skeleton-row" key={index} />
                ))}
            </div>
        </div>
    );
}

/**
 * Renders a reusable empty-state panel for workspace data regions.
 */
export function EmptyState({
    action,
    body,
    title,
}: EmptyStateProps): JSX.Element {
    return (
        <section className="ef-state ef-state--empty" aria-label={title}>
            <div className="ef-state__icon" aria-hidden="true">
                0
            </div>
            <h2>{title}</h2>
            <p>{body}</p>
            {action}
        </section>
    );
}

/**
 * Renders a reusable query error panel with a retry action.
 */
export function ErrorState({
    isRetrying = false,
    message,
    onRetry,
    title = "Unable to load data",
}: ErrorStateProps): JSX.Element {
    return (
        <section className="ef-state ef-state--error" aria-label="Error state">
            <div className="ef-state__icon" aria-hidden="true">
                !
            </div>
            <h2>{title}</h2>
            <p>{message}</p>
            <Button disabled={isRetrying} onClick={onRetry} variant="secondary">
                {isRetrying ? "Retrying..." : "Retry"}
            </Button>
        </section>
    );
}
