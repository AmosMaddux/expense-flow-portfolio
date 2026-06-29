# 0001. Store Expense Report Case records in PostgreSQL

- Status: Proposed
- Date: 2026-06-26
- Related: [ADR 0002: Polyglot Service Split Placeholder](./0002-polyglot-service-split-placeholder.md)

## Context

ExpenseFlow Corporate manages each `Expense Report` as a durable case for a multi-tenant corporate finance workflow. The Core Case Service owns the case lifecycle and must preserve a complete, reviewable record of workflow state, role-gated transitions, comments, attachments metadata, audit trail entries, and stage-transition history.

An `Expense Report` moves through six sequence-enforced stages:

1. `Drafted`
2. `Submitted`
3. `Manager Approval`
4. `AP Review`
5. `Paid`
6. `Reconciled`

`current_stage` is the source of truth for case condition. There is no separate status field. Rejections at `Manager Approval` or `AP Review` move the case backward to `Drafted`, and `Reconciled` is terminal.

ExpenseFlow also requires tenant isolation. Every case query and mutation must be scoped by tenant so one tenant cannot read, write, infer, search, export, or receive another tenant's data. The case store must support auditable, least-privilege access for `Finance Admin`, `Department Manager`, and `Employee` workflows without placing controlled data in logs, fixtures, documentation, or prompts.

## Decision

The Core Case Service will store the `Expense Report` Case in PostgreSQL and access it through Drizzle.

The relational schema will model the case as the durable aggregate root for:

<!-- Assumes future design, update if contrary -->
- Case identity, tenant identity, `current_stage`, owner assignment, due date, priority, `on_hold`, and `hold_reason`.
- Transactions, receipt metadata, mileage entries, submitter, approval chain, payment stub reference, comments, and attachment metadata.
- Audit trail entries and stage-transition log records that preserve successful and denied workflow transition attempts.

Drizzle will be used as the TypeScript data access and migration layer for the Core Case Service so schema definitions, query construction, migrations, and application types remain aligned.

Tenant isolation will be represented directly in PostgreSQL table design and service queries. Case-owned tables will carry tenant-scoping fields or enforce tenant scope through required relationships to the case aggregate. Core Case Service repository methods must require tenant context for reads and writes.

## Alternatives Considered

### Document database

A document database could store the case, transactions, receipts, comments, and audit trail in one flexible document. This was rejected because ExpenseFlow's case workflow depends on sequence-enforced transitions, tenant-scoped querying, auditability, reviewable migrations, and consistent relational constraints across related records.

The repository contract also forbids MongoDB for this project.

### In-memory or file-based storage

In-memory or file-based storage would be simple for local prototypes, but it does not provide durable multi-user behavior, transactional updates, migration history, tenant-scoped query controls, or auditable operational behavior. It is not appropriate for the Core Case Service.

### Event store as the primary case store

An event store could represent every case mutation as an append-only fact. That may be useful in a future architecture, but it adds query, projection, and operational complexity that is not needed for the MVP. The MVP still records audit trail entries and stage-transition logs in PostgreSQL while keeping the current case state directly queryable.

### Separate storage per tenant

Separate databases or schemas per tenant can create strong physical boundaries. For the MVP, this increases provisioning, migration, and operational complexity. ExpenseFlow will use a shared PostgreSQL deployment with explicit tenant scoping in schema design, repository methods, authorization checks, and tests.

## Consequences

PostgreSQL gives the Core Case Service transactional integrity for case updates, workflow transitions, audit trail writes, and related record changes. This supports durable review of the six-stage workflow and denied transition attempts.

The team must keep `current_stage` as the workflow source of truth and avoid adding a separate status field. Any schema, model, or route change that alters case storage, tenant boundaries, or workflow contracts must update or supersede this ADR.

All Core Case Service queries and mutations must preserve tenant isolation. Tests must include tenant-isolation and authorization coverage using synthetic data only.

Drizzle migrations become part of the review surface for case storage changes. Migration files, tests, seed data, and documentation must not contain controlled data, production data, real tenant identifiers, payment details, credentials, tokens, API keys, or secrets.

The relational design may require more explicit schema evolution than a document model, but that tradeoff is acceptable because ExpenseFlow needs durable, reviewable case records and consistent workflow constraints.
