# ExpenseFlow STRIDE Threat Model

## Scope and security objectives

This model covers the Expense Report lifecycle: employee submission and receipt upload, internal approval, AP Review and GL coding, payment-stub issuance, reconciliation, audit recording, and asynchronous stage-transition processing. The [ExpenseFlow data-flow diagram](Architecture/expenseflow-data-flow.mmd) is the source diagram. It identifies the employee and internal-user client trust boundaries, the ExpenseFlow application boundary, shared data stores, and managed event messaging.

The security objectives are to:

- prevent one tenant from reading, writing, receiving, or inferring another tenant's records, receipts, payment references, or events;
- prevent controlled receipt and payment data from entering logs, errors, traces, analytics, audit events, queues, or prompts;
- ensure that only an authenticated, authorized actor can advance an Expense Report or issue a payment stub; and
- retain enough non-controlled audit evidence to determine who performed each sensitive action and whether it succeeded.

Payment data and receipts are controlled data under the [data-classification policy](data-classification.md). A payment stub is not a banking integration and must not contain or expose payment-instrument or bank-account data.

## Trust-boundary assumptions

- The API derives tenant scope and role from authenticated identity claims. Request-supplied tenant identifiers are never trusted for authorization.
- PostgreSQL, receipt objects, GL data, projections, and messaging are shared infrastructure. Isolation relies on application authorization, tenant predicates, database constraints, receipt metadata checks, tenant-prefixed object keys, and least-privilege IAM rather than a physical tenant boundary.
- Receipt access requires an authorized receipt-metadata lookup before tenant-prefixed object access.
- The durable outbox, SNS topic, SQS queue, DLQ, and projection store process tenant-bearing transition events. Event schemas, publish and consume permissions, replay, idempotency, redrive, and logging are in scope.
- The View as role switcher is a design-review aid only; production authorization uses the authenticated user's role and tenant.

## Risk disposition

Implemented - verify means the listed control is required or present but must be demonstrated by automated tests or release evidence as part of the owning team's normal delivery work. Open - planned means the mitigation is required before the named capability is released. No risk in this table is accepted without an owner, written compensating controls, and a time-bounded Security approval through the PR suppression process.

## STRIDE risk register

| ID | STRIDE | Threat and affected boundary | Mitigations | Owner | Disposition |
| --- | --- | --- | --- | --- | --- |
| STRIDE-01 | Spoofing | A stolen, forged, expired, or cross-tenant token is used at the Employee Portal, Internal Finance Workspace, or API to act as another user. | Require email/password and MFA; validate token signature, issuer, audience, expiry, subject, role, and tenant claims on every protected request; reject missing or inconsistent claims; use authenticated identity rather than request body fields for actor and tenant. | Identity and Access team | Implemented - verify with authentication and tenant-mismatch tests. |
| STRIDE-02 | Spoofing | A service, event publisher, or queue consumer impersonates a trusted component to inject a tenant-bearing transition event. | Use separate least-privilege IAM roles for publishers and consumers; restrict topic and queue resource policies to those roles; authenticate service-to-service calls; validate event version and schema before processing. | Platform Engineering | Open - planned before asynchronous transition processing is released. |
| STRIDE-03 | Tampering | A client supplies a different tenant ID, Expense Report ID, owner, stage, amount, GL coding, or payment-stub reference to modify a record outside its authority. | Validate every inbound shape with Zod; derive tenant and actor from authentication; apply tenant predicates to every read and write; enforce database constraints; enforce role-gated, sequence-valid workflow transitions; record allowed and denied transitions. | Core Case Service team | Implemented - verify with negative authorization, cross-tenant, and workflow-transition tests. |
| STRIDE-04 | Tampering | Receipt object keys or metadata are altered to associate a receipt with another tenant or Expense Report. | Generate object keys server-side with a tenant prefix; authorize receipt metadata before object access; validate content type and size; make receipt metadata writes tenant-scoped; restrict object-store permissions to the required prefix and service role. | Core Case Service team | Open - planned before receipt upload or retrieval is released. |
| STRIDE-05 | Tampering | Replay, duplicate delivery, or unauthorized redrive changes workflow state twice or applies another tenant's event. | Use durable outbox records, idempotency keys, event IDs, consumer deduplication, tenant-aware event validation, bounded retries, and restricted DLQ redrive permissions; audit processing outcome without controlled payload data. | Platform Engineering | Open - planned before event consumers or DLQ redrive are released. |
| STRIDE-06 | Repudiation | An employee or internal user denies submitting, approving, rejecting, coding, reconciling, or issuing a payment stub. | Write append-only audit records with actor, role, tenant-safe case identifier, action, outcome, timestamp, and correlation ID; retain outbox and consumer outcome evidence; do not place receipt or payment contents in audit payloads. | Core Case Service team | Implemented - verify with audit-trail tests for allowed and denied actions. |
| STRIDE-07 | Information disclosure | A missing tenant predicate, insecure direct object reference, broad search/export, cache key collision, or operational tool exposes another tenant's Expense Reports, receipts, payment references, GL mappings, or audit records. | Authorize every read and write with authenticated tenant and role; use tenant-scoped queries, cache keys, exports, projections, and operational tooling; require metadata authorization before receipt retrieval; test cross-tenant access using synthetic fixtures. | Core Case Service team | Implemented - verify with tenant-isolation tests covering API, receipt metadata, projections, and exports. |
| STRIDE-08 | Information disclosure | Receipt, payment, or reimbursement data appears in logs, errors, traces, analytics, audit events, queues, webhooks, test output, or prompts. | Use allowlisted structured logging and redaction; emit only synthetic-safe identifiers and aggregates; prohibit controlled fields from audit and event payloads; review telemetry and failure paths; apply the data-classification policy to fixtures and evidence. | Security Engineering | Open - planned telemetry review before payment-stub and receipt capabilities are released. |
| STRIDE-09 | Information disclosure | Over-broad database, object-store, topic, queue, or consumer IAM access lets a compromised service retrieve or publish tenant data outside its purpose. | Separate service identities; grant only required actions and resource prefixes; scope database credentials and network paths; restrict queue/topic policies; review IAM changes as infrastructure code. | Platform Engineering | Open - planned; verify at infrastructure deployment and every IAM change. |
| STRIDE-10 | Denial of service | Large receipt uploads, credential attacks, expensive searches, duplicate submissions, event floods, or DLQ replay exhaust shared capacity and make another tenant's work unavailable. | Apply tenant-aware rate, concurrency, request-size, and upload-size limits; use pagination and query bounds; use idempotency keys; set timeouts and bounded retries; monitor queue depth and redrive activity. | Platform Engineering | Open - planned before public receipt upload and asynchronous processing are released. |
| STRIDE-11 | Elevation of privilege | An Employee, Department Manager, or UI role switcher performs Finance Admin-only actions, accesses an unassigned case, or advances a stage without server-side permission. | Enforce permissions server-side from authenticated role and tenant; keep the role switcher out of authorization decisions; enforce documented role and stage rules for approvals, AP Review, payment stubs, reconciliation, GL mapping, and audit access; audit denied attempts. | Core Case Service team | Implemented - verify with role-permission matrix tests. |
| STRIDE-12 | Elevation of privilege | A CI, deployment, or runtime identity with excessive permissions changes code, images, task definitions, or data access paths to bypass tenant or payment protections. | Use branch protection and required gates; use least-privilege GitHub, cloud, and runtime identities; scan and sign release images; require image signature and SBOM-attestation verification before task-definition registration. | Platform Engineering | Implemented - verify through the PR and release security gates below. |

## Security-gate traceability

The risk register relies on, but does not replace, the following gates:

| Gate | Relevance to this model | Required evidence / response |
| --- | --- | --- |
| [Secure PR Gate](secure-pr-gate-suppressions.md) | Runs Semgrep, Bandit, OSV-Scanner, and Gitleaks on every pull request. It helps detect insecure authorization and logging patterns, vulnerable dependencies, and accidental secrets that could undermine tenant or payment-data controls. | The aggregate Secure PR Gate must pass. Any scanner suppression must have an owner, rationale, compensating controls, Security CODEOWNER approval, and a review-by date no more than 90 days away. Never suppress a real credential. |
| [Secure Release Gate](secure-release-gate.md) | Scans each service image with Trivy, generates a Syft SBOM, signs and attests the image with Cosign, verifies the signature and SBOM before task-definition registration, and runs ZAP against the deployed sandbox API after manual redeploy. | No critical Trivy finding may ship. The deployed image must have a verifiable signature and CycloneDX SBOM attestation. A ZAP High finding blocks the sandbox redeploy script and must be triaged by the owning team and Security Engineering. |

The PR template additionally requires reviewers to check tenant isolation, authorization, audit-trail impact, input validation, workflow stage rules, and safe logging. A code or infrastructure change that affects a register entry must cite its risk ID in the pull request summary or reviewer notes and include the corresponding test or gate evidence.

## Review triggers

Security Engineering and the owner of the affected risk must review this model and its diagram when an API, workflow stage, datastore, external integration, authentication claim, receipt-storage path, payment-stub behavior, event schema, IAM policy, logging/telemetry path, or deployment control changes. Reassess any Open - planned entry before releasing its dependent capability.
