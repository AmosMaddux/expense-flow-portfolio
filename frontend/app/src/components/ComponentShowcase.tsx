import { Badge, Button, OverdueBadge, StageStepper, StatusBadge } from ".";

/**
 * Renders local examples for reviewing shared component primitives in-app.
 */
export function ComponentShowcase(): JSX.Element {
    return (
        <section
            aria-label="Shared component library preview"
            className="component-showcase"
        >
            <div className="component-showcase__header">
                <p className="screen-placeholder__label">Component Library</p>
                <h2>Shared ExpenseFlow primitives</h2>
            </div>

            <div className="component-showcase__group">
                <h3>Buttons</h3>
                <div className="component-showcase__row">
                    <Button>Approve</Button>
                    <Button variant="secondary">Request info</Button>
                    <Button variant="ghost">View audit trail</Button>
                    <Button variant="danger">Reject</Button>
                </div>
            </div>

            <div className="component-showcase__group">
                <h3>Badges</h3>
                <div className="component-showcase__row">
                    <Badge>Drafted</Badge>
                    <StatusBadge label="Manager Approval" tone="info" />
                    <StatusBadge label="Paid" tone="success" />
                    <StatusBadge label="Flagged" tone="warning" />
                    <OverdueBadge isOverdue />
                    <OverdueBadge isOverdue={false} />
                </div>
            </div>

            <div className="component-showcase__group">
                <h3>Stage Stepper</h3>
                <StageStepper currentStage="AP Review" />
                <StageStepper currentStage="Manager Approval" onHold />
            </div>
        </section>
    );
}
