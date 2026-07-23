# 0003. Use storage per bounded context

- Status: Accepted
- Date: 2026-07-21
- Related: [ADR 0001: Store Expense Report Case records in PostgreSQL](./0001-expense-report-case-postgresql.md), [Service ownership boundaries](../service-boundaries.md)

## Context

ExpenseFlow separates domain responsibility by bounded context. The [Service ownership boundaries](../service-boundaries.md) document defines which service owns `Expense Report` case workflow, GL coding, identity, and related responsibilities. Storage decisions must follow those ownership boundaries without creating duplicate sources of truth.

The Core Case Service needs durable workflow state for `Expense Report` cases, request coordination for retried write operations, and low-latency derived reads for queue-style views. These concerns have different access patterns, durability requirements, and failure behavior, so using one datastore for all of them would either overfit operational state to the domain model or make durable case state depend on disposable infrastructure.

Every datastore design must preserve tenant isolation. Keys, records, indexes, queries, invalidation paths, and cache fallback behavior must make cross-tenant access or key collision impossible by construction, using tenant context derived from authenticated identity.

## Decision

ExpenseFlow will use storage per bounded context and storage concern:

- Long-term `Expense Report`, GL, identity, audit, and related operational state is stored in PostgreSQL.
- Dashboard and Case Queue read projections may be stored in DynamoDB.
- Idempotency locks, completed idempotency responses, Case Queue rollup cache entries, and other short-lived application cache values are stored in Redis.

No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis. Each write path must define which datastore operation is authoritative, which operations are request-coordination or cache operations, and which operations may be retried, expired, invalidated, or bypassed after failure.

## PostgreSQL: Core Case, GL, Identity, and Rate-Limit State

PostgreSQL is the authoritative system of record for active Core Case Service case data. This includes `Expense Report` cases, line items, mileage entries, comments, attachment and receipt metadata references, `current_stage`, `on_hold`, `hold_reason`, audit trail entries, stage-transition log records, and GL-coding result history attached to an expense report.

The MVP also stores GL reference tables, Identity/Auth tables, and tenant rate-limit windows in the same Core Case PostgreSQL deployment. The `gl_code`, `gl_mapping`, and `gl_coding_result` tables are physically in PostgreSQL while GL Coding remains a separate ownership boundary. The `user`, `credential`, `role`, `refresh_token`, `mfa_enrollment`, and `authentication_audit_entry` tables are physically in PostgreSQL while Identity remains a separate ownership boundary. `tenant_rate_limit_window` is operational counter state, not durable case domain state.

PostgreSQL fits these responsibilities because the active Core Case Service needs strong transactional consistency, relational constraints, referential integrity, and multi-row transactions where a workflow mutation must update case state and write audit-related records together. The service also needs queryable state for Case Queue rollups and lists, Case Detail, Employee Portal status, and review workflows.

The expected consistency model is strong consistency within PostgreSQL transactions. Workflow mutations use PostgreSQL transactions where related case, audit, stage-transition, and GL-coding-result changes must commit or roll back together. `current_stage` remains the source of truth for case condition, and audit-related records are committed with the authoritative domain change where applicable.

Tenant isolation is enforced through mandatory `tenant_id` scoping in tables, constraints, repository methods, and service queries. Case-owned child tables carry tenant scope and enforce it through composite relationships to the `Expense Report` aggregate. GL and Identity tables also carry tenant scope directly or through tenant-scoped relationships. Request bodies are not trusted for tenant isolation; tenant scope comes from authenticated identity and must be present on reads, writes, tests, and migrations that affect tenant-scoped data.

The main trade-offs are explicit schema migrations, relational scaling limits, index management, and careful transaction design. The team must review migrations, indexes, locks, and query plans as case volume grows. Those costs are acceptable because durable workflow state needs reviewable constraints and consistent updates more than flexible key-value access.

PostgreSQL must not become a dumping ground for Redis-style disposable cache entries or DynamoDB read projections. It may store operational state when the current code intentionally uses PostgreSQL semantics, such as atomic tenant rate-limit counters. It also must not store duplicate authoritative copies of GL Coding Service or Identity Service records beyond the MVP tables explicitly assigned to those service ownership boundaries.

Redis and DynamoDB must not become authoritative sources for active `Expense Report` state. Case Queue data is derived from PostgreSQL, and PostgreSQL remains the source from which that value can be verified or rebuilt.

## DynamoDB: Dashboard and Case Queue Read Projections

DynamoDB stores read-optimized `Expense Report` projection data for dashboard and Case Queue access patterns. The repository currently contains a DynamoDB-backed Expense Report case-store module that queries tenant-scoped records and calculates stage and overdue rollups from `currentStage` and `dueDate` attributes.

These records are not authoritative `Expense Report` domain state. They are projections that can be rebuilt from PostgreSQL. The current default Case Queue path reads through Redis when configured and otherwise falls back to PostgreSQL; the DynamoDB case-store module exists for read-model access patterns and tests but is not wired into the default Case Queue service.

DynamoDB fits this responsibility because dashboard and queue reads are access-pattern-first: the service can query by tenant through `DYNAMODB_EXPENSE_REPORT_TENANT_INDEX` and project only the attributes needed for rollups. This keeps high-volume read projections separate from the normalized PostgreSQL domain model while preserving PostgreSQL as the source of truth.

The expected consistency model is eventual consistency for derived reads. A DynamoDB projection may briefly lag the PostgreSQL source after a workflow mutation, and application behavior must tolerate that lag. PostgreSQL remains authoritative for workflow state, audit trail, GL coding history, Identity/Auth records, and any write requiring relational integrity or transactionality.

Tenant isolation is enforced by including `tenantId` in the projection item and tenant index design. Dashboard and Case Queue reads must query using tenant scope derived from authenticated identity, not request body tenant input, so two tenants cannot read or collide with each other's projection data.

The main trade-offs are projection freshness, limited ad hoc querying, AWS-specific operational complexity, capacity planning, and schema design that must start from known dashboard and queue access patterns. Projection update or rebuild behavior must be explicit before DynamoDB is used in a production read path.

DynamoDB must not store authoritative workflow stage, audit trail, GL coding output, identity records, idempotency records, or cache entries. If a projection contains an `Expense Report` stage or due date for dashboard reads, that copy is derived and must be repairable from PostgreSQL.

## Redis: Idempotency Locks and Application Caching

Redis stores derived, disposable cache entries such as Case Queue rollups, completed idempotency response entries, short-lived idempotency locks, and other application cache values. These values exist to reduce read latency or coordinate concurrent request attempts, not to define business state.

Redis fits this responsibility because cache-aside access supports common queue reads when `REDIS_URL` is configured: the service checks Redis for a tenant-scoped Case Queue rollup entry, falls back to PostgreSQL on a miss, and repopulates Redis with a derived value. If Redis is not configured, the default Case Queue service reads directly from PostgreSQL. Stage transitions invalidate tenant rollups by incrementing a tenant-scoped cache-version key, and rollup entries have a configurable TTL that defaults to 30 seconds.

Redis idempotency locks use tenant-scoped keys in the format `lock:{tenantId}:{idempotencyKey}` with a 30-second TTL. They are short-lived concurrency guards only: losing a lock may allow a later attempt to compete for the same write path, but it must not erase committed PostgreSQL state. Redis idempotency result entries use tenant-scoped keys in the format `idem:{tenantId}:{idempotencyKey}` and store completed responses for 24 hours.

The expected consistency model is eventual consistency with bounded staleness for derived application reads and best-effort coordination for idempotency entries. A Case Queue cache hit may briefly return a stale derived view after a write, but tenant-version invalidation and TTLs bound staleness and the authoritative state remains in PostgreSQL. Cache misses, expired entries, evicted entries, and rebuilds fall back to PostgreSQL for case data.

Tenant isolation is enforced through tenant-scoped cache keys. Cache keys must include authenticated tenant context or an equivalent tenant-isolating prefix, and cached values must not combine data from multiple tenants unless the key and authorization model explicitly represent a platform-level aggregate. The MVP should not use platform-level aggregates for tenant business data.

The main trade-offs are invalidation complexity, stale reads, memory pressure, eviction behavior, and another operational dependency. Redis outages or missing Redis configuration should degrade Case Queue performance and increase PostgreSQL read load. Redis outages may also affect in-progress idempotency coordination, but they must not corrupt or lose authoritative PostgreSQL business state.

Redis must never become the system of record for case workflow, audit trail, GL coding, identity, or long-term request history. Redis values are derived or short-lived and rebuildable, and deleting the cache must not delete business state.

## Cross-Datastore Rules

- PostgreSQL remains the authoritative source for `Expense Report` state.
- PostgreSQL transactions cover related case, audit, stage-transition, and GL-coding-result writes; they do not span DynamoDB or Redis.
- DynamoDB values are dashboard and Case Queue read projections, not authoritative domain records.
- Redis values are derived, disposable, and rebuildable from PostgreSQL or coordinated by short TTLs.
- Redis stores idempotency locks and completed idempotent responses, but Redis cache loss must not corrupt authoritative PostgreSQL mutations.
- No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis.
- Failure handling must define which datastore operation is authoritative and which operations may be retried, expired, invalidated, or bypassed.
- Every key, query, record, and invalidation design must preserve tenant isolation.
- Request bodies are not trusted for tenant isolation; tenant context comes from authenticated identity.
- Cross-datastore records may reference stable identifiers, but they must not duplicate another datastore's authoritative records as a second source of truth.

## Consequences

This decision keeps durable domain state, operational request coordination, and disposable read optimization separate. It lets each storage technology serve the access pattern it is best suited for while preserving a clear source-of-truth model.

Application code must be explicit about write ordering and recovery. The current idempotent write flow checks Redis for a completed result, acquires a short-lived Redis lock, performs the authoritative PostgreSQL transaction, saves the completed result in Redis, and releases the Redis lock. If Redis invalidation or idempotency-result caching fails after PostgreSQL commits, the system should rely on TTLs, cache bypass, or another retry rather than rolling back the committed domain change.

Future remediation should choose one concrete recovery guarantee before relying on Redis-only idempotency for higher-volume or higher-risk write paths. Viable options include a PostgreSQL idempotency ledger that stores a tenant-scoped operation key and replayable result in the same transaction as the authoritative mutation; a stable operation identifier with a PostgreSQL uniqueness constraint on the affected domain rows or operation table; or an outbox or reconciliation path that records committed operations in PostgreSQL and repairs Redis idempotency entries or DynamoDB read projections asynchronously.

Operationally, the team must monitor and manage PostgreSQL migrations and indexes, DynamoDB projection freshness and capacity, and Redis memory, eviction, and availability. Tests should cover tenant isolation, idempotency replay behavior, cache fallback behavior, projection behavior, and failure behavior using synthetic data only.

## Alternatives Considered

### PostgreSQL for all state

Using PostgreSQL for case state, dashboard read projections, idempotency locks, and Redis-style cache entries would reduce infrastructure variety. This was rejected because dashboard reads, request retry coordination, and disposable cache data have different lifecycle and access patterns from durable workflow state. Storing all of it in PostgreSQL would increase table churn and mix projection, idempotency, and cache concerns into the domain store. PostgreSQL is still used for tenant rate-limit windows because the current implementation needs atomic per-tenant counters, not a rebuildable cache.

### DynamoDB as the primary case store

DynamoDB could scale key-based case lookups and conditional writes, but it does not naturally fit the relational integrity, multi-row workflow transactions, audit-related joins, migration review, and tenant-scoped query needs of the Core Case Service. It would also make ad hoc review workflows and relational constraints harder.

### Redis as a shared state layer

Redis can provide fast reads and simple coordination primitives, but it is not appropriate as the system of record for ExpenseFlow business data. Eviction, memory pressure, TTL expiration, and outage behavior make it a poor fit for durable case state, audit records, or long-term request history. Redis is acceptable for current idempotency locks and completed response caching because those values are tenant-scoped, short-lived, and separate from the authoritative PostgreSQL mutation.

### Distributed transactions across datastores

Coordinating PostgreSQL, DynamoDB, and Redis through distributed transactions was rejected because it would add operational complexity and failure modes that are not necessary for the MVP. ExpenseFlow will instead define authoritative PostgreSQL writes, DynamoDB read projections, Redis locks and caches, cache invalidation, TTLs, and fallback paths.
