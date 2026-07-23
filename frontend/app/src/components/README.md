# ExpenseFlow Component Library

Shared React primitives live in this folder so screens can reuse consistent controls and workflow indicators.

## Buttons

```tsx
import { Button } from "./components";

<Button>Approve</Button>;
<Button variant="secondary">Request info</Button>;
<Button variant="ghost">View audit trail</Button>;
<Button variant="danger">Reject</Button>;
```

## Badges

```tsx
import { Badge, OverdueBadge, StatusBadge } from "./components";

<Badge>Drafted</Badge>;
<StatusBadge label="Manager Approval" tone="info" />;
<OverdueBadge isOverdue />;
```

## Stage Stepper

```tsx
import { StageStepper } from "./components";

<StageStepper currentStage="AP Review" />;
```

The default stage order is `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`, and `Reconciled`.
