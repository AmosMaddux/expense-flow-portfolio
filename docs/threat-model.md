# ExpenseFlow STRIDE Threat Model

## Scope and data-flow diagram

The threat-model scope is the Expense Report lifecycle: employee submission and receipt upload, internal approval, AP Review and GL coding, payment-stub issuance, reconciliation, audit recording, and asynchronous stage-transition processing. The [ExpenseFlow data-flow diagram](Architecture/expenseflow-data-flow.mmd) is the source diagram for this model. It distinguishes employee and internal-user client trust boundaries, the ExpenseFlow application boundary, shared data stores, and managed event messaging.

## Trust-boundary assumptions

- The API derives tenant scope and role from authenticated identity claims. Request-supplied tenant identifiers are not trusted.
- PostgreSQL, receipt objects, GL data, projections, and messaging are shared infrastructure. Tenant isolation is enforced by application authorization, tenant predicates, database constraints, metadata checks, object-key construction, and least-privilege IAM rather than a physical tenant boundary.
- A payment stub is not a banking integration. Payment information is controlled data and must not be emitted in logs, audit payloads, queues, or traces.
- Receipt content is controlled data. Object-store access requires an authorized receipt-metadata lookup followed by tenant-prefixed object access.
- The durable outbox, SNS topic, SQS queue, DLQ, and projection store process tenant-bearing transition events. Event schemas, publish and consume permissions, redrive, replay, idempotency, and logging are in scope.

## STRIDE analysis

| Category | Threat surface | Required mitigation |
| --- | --- | --- |
| Spoofing | Employee Portal, Internal Finance Workspace, and API calls | Authenticate with email, password, and MFA; validate signed access-token claims before every protected operation. |
| Tampering | Submission, approval, GL coding, payment-stub, receipt, audit, outbox, and projection writes | Validate request and event shapes; enforce stage and role transitions; use tenant predicates and database constraints; record allowed and denied transitions in the audit trail. |
| Repudiation | Approval, rejection, AP Review, payment-stub issuance, reconciliation, and event processing | Persist an append-only audit record with actor, action, outcome, timestamp, and synthetic-safe identifiers; retain correlated outbox and consumer processing outcomes. |
| Information disclosure | Shared stores, receipt object store, payment-stub data, GL mappings, audit reads, and tenant-bearing events | Authorize every read and write by authenticated tenant and role; require metadata authorization before tenant-prefixed object access; use least-privilege database, object-store, topic, queue, and consumer permissions; redact controlled data from logs and traces. |
| Denial of service | Submission and approval APIs, receipt uploads, GL-coding calls, SNS/SQS delivery, and DLQ redrive | Apply tenant-aware rate limits, request-size limits, idempotency handling, bounded retries and timeouts, queue access policies, and monitored DLQ redrive. |
| Elevation of privilege | Role claims, approval actions, GL coding, payment-stub issuance, and publish or consume permissions | Enforce server-side permissions for Employee, Department Manager, and Finance Admin actions; scope publisher and consumer IAM roles; never use the UI role switcher as authorization. |

## Review triggers

Review this model and its diagram when an API, workflow stage, datastore, external integration, authentication claim, receipt-storage path, or payment-stub behavior changes.
