# 0002. Polyglot Service Split Placeholder

- Status: Proposed
- Date: 2026-06-29
- Depends On: [ADR 0001: Store Expense Report Case records in PostgreSQL](./0001-expense-report-case-postgresql.md)

## Context

As ExpenseFlow's domain capabilities expand, keeping all application responsibilities inside a single codebase introduces scaling friction. The team needs to evaluate whether responsibilities should be isolated into independent, language-optimized services during Sprint 2.

This structural split targets the following distinct contexts:

- **Core Case Context:** Handles central workflow states, compliance data boundaries, and case storage management.
    - Ex: Saves the base record to the database with an initial current_stage of Submitted.
- **Domain Compute Context:** Handles high-throughput processing, validation calculations, and line-item matrix computation.
    - Ex: Evaluates conditional threshold logic: if amount_usd > 500.00, trigger a data flag.
- **Identity Context:** Handles tenant isolation, token handling, and authorization rules.
    - Ex: Intercepts the incoming API request and decodes the cryptographic JSON Web Token (JWT) to verify the user's signature.

## Decision

Deferred to Sprint 2 design review. This record serves as an intentional placeholder stub for the final polyglot separation strategy.

## Consequences

- **Traceability:** Linked directly from the storage architecture record to maintain a clear system timeline.

### Positives (Pros)

- **[Optimized Tooling/Ecosystem]:** Explain how separating boundaries lets you choose specialized languages or libraries optimized for that explicit context.
- **[Granular Scalability]:** Explain how resource-heavy operations can be decoupled and scaled independently from light operational endpoints.
- **[Isolated Fault Domains]:** Explain how separating these boundaries limits the runtime blast radius of a memory crash or a third-party outage.

### Negatives (Cons)

- **[Operational & Tooling Overhead]:** Detail the added friction of managing multiple package managers, code repositories, or linting configurations.
- **[Network & Serialization Costs]:** Detail the serialization latency and network overhead introduced when moving from memory calls to network APIs.
- **[Distributed Consistency Effort]:** Detail the engineering complexity required to maintain data integrity across split data stores or independent transaction lifecycles.

## Alternatives Considered

- **[Alternative Option A]:** Briefly explain option A, such as keeping a unified modular monolith.
- **[Alternative Option B]:** Briefly explain option B, such as splitting services but forcing a single language/runtime engine.
