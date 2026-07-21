# 0003. Use storage per bounded context

- Status: Accepted
- Date: 2026-07-21
- Related: [ADR 0001: Store Expense Report Case records in PostgreSQL](./0001-expense-report-case-postgresql.md), [Service ownership boundaries](../service-boundaries.md)

## Context

ExpenseFlow separates domain responsibility by bounded context. The [Service ownership boundaries](../service-boundaries.md) document defines which service owns `Expense Report` case workflow, GL coding, identity, and related responsibilities. Storage decisions must follow those ownership boundaries without creating duplicate sources of truth.

The Core Case Service needs durable workflow state for `Expense Report` cases, request coordination for retried write operations, and low-latency derived reads for queue-style views. These concerns have different access patterns, durability requirements, and failure behavior, so using one datastore for all of them would either overfit operational state to the domain model or make durable case state depend on disposable infrastructure.

Every datastore design must preserve tenant isolation. Keys, records, indexes, queries, invalidation paths, and repair procedures must make cross-tenant access or key collision impossible by construction, using tenant context derived from authenticated identity.

## Decision

ExpenseFlow will use storage per bounded context and storage concern:

- `Expense Report` state is stored in PostgreSQL.
- Idempotency records are stored in DynamoDB.
- Case Queue and application cache entries are stored in Redis.

No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis. Each write path must define which datastore operation is authoritative, which operations are request-coordination or cache operations, and which operations may be retried, expired, invalidated, or repaired after failure.

## PostgreSQL: Expense Report State

PostgreSQL is the authoritative system of record for durable Core Case Service domain state. This includes `Expense Report` cases, source transactions, line items, mileage entries, submitter and approval-chain data, comments, attachment and receipt metadata references, `current_stage`, `on_hold`, `hold_reason`, payment stub references, audit trail entries, and stage-transition log records.

PostgreSQL fits this responsibility because the Core Case Service needs strong transactional consistency, relational constraints, referential integrity, and multi-row transactions where a workflow mutation must update case state and write audit-related records together. The service also needs queryable durable state for the Case Queue, Case Detail, Employee Portal status, and review workflows.

The expected consistency model is strong consistency within a PostgreSQL transaction. Workflow mutations must use transactions where related state changes must commit or roll back together. `current_stage` remains the source of truth for case condition, and durable audit-related records must be committed with the authoritative domain change where applicable.

Tenant isolation is enforced through mandatory `tenant_id` scoping in tables, constraints, repository methods, and service queries. Case-owned tables either carry tenant scope directly or enforce it through required relationships to the `Expense Report` aggregate. Request bodies are not trusted for tenant isolation; tenant scope comes from authenticated identity and must be present on reads, writes, tests, and migrations that affect tenant-scoped data.

The main trade-offs are explicit schema migrations, relational scaling limits, index management, and careful transaction design. The team must review migrations, indexes, locks, and query plans as case volume grows. Those costs are acceptable because durable workflow state needs reviewable constraints and consistent updates more than flexible key-value access.

PostgreSQL must not become a dumping ground for disposable cache entries or request retry markers whose lifecycle is operational rather than domain-owned. It also must not store duplicate authoritative copies of GL Coding Service or Identity Service records beyond the MVP tables explicitly assigned to those service ownership boundaries.

Redis and DynamoDB must not become authoritative sources for `Expense Report` state. If either contains a value derived from an expense report, PostgreSQL remains the source from which that value can be verified or rebuilt.

## DynamoDB: Idempotency Records

DynamoDB stores idempotency records used to prevent duplicate processing of retried write requests. These records coordinate request handling for operations such as create, submit, approve, reject, or other write commands, but they are not authoritative `Expense Report` domain state.

DynamoDB fits this responsibility because idempotency lookups are access-pattern-first: the service needs fast lookup by a deterministic tenant-scoped idempotency key and atomic create-if-absent behavior. Conditional writes, or equivalent atomic conditional operations, allow one request attempt to claim a key while duplicate attempts receive the prior result or an in-progress response. TTL expiration removes old request-coordination records without requiring long-term domain retention.

The expected consistency model is conditional-write consistency around the idempotency key. Strongly consistent reads may be used when a write path must observe a just-written idempotency record before deciding whether to proceed, but conditional operations are the primary correctness control. Eventual-consistency defaults are acceptable only where a stale read cannot cause duplicate authoritative PostgreSQL mutations.

Tenant isolation is enforced by including `tenant_id` in the partition-key design, or by an equivalent key design that makes cross-tenant key collisions impossible. Idempotency keys supplied by clients must be scoped to the authenticated tenant before storage or lookup, so two tenants using the same client-provided key cannot affect each other.

The main trade-offs are eventual consistency defaults, limited ad hoc querying, AWS-specific operational complexity, capacity planning, and schema design that must start from known access patterns. TTL deletion is not immediate, so application logic must tolerate expired records remaining visible for a period.

DynamoDB must not store authoritative expense-report fields, workflow stage, audit trail, GL coding output, identity records, or cache projections. It coordinates duplicate-request handling but does not replace PostgreSQL transactions. A successful idempotency claim only permits the service to attempt the authoritative PostgreSQL mutation; it is not itself proof that the domain change occurred.

## Redis: Case Queue and Application Caching

Redis stores derived, disposable cache entries such as Case Queue rollups and other application cache values. These values exist to reduce read latency or database load, not to define business state.

Redis fits this responsibility because cache-aside access supports common queue reads: the service checks Redis for a tenant-scoped cache entry, falls back to PostgreSQL on a miss, and repopulates Redis with a derived value. Relevant PostgreSQL writes must invalidate or refresh affected cache entries, and every cache entry must have a TTL so stale values are bounded even when an invalidation path is missed.

The expected consistency model is eventual consistency with bounded staleness. A cache hit may briefly return a stale derived view after a write, but the authoritative state remains in PostgreSQL. Cache misses, expired entries, evicted entries, and rebuilds must fall back to PostgreSQL.

Tenant isolation is enforced through tenant-scoped cache keys. Cache keys must include authenticated tenant context or an equivalent tenant-isolating prefix, and cached values must not combine data from multiple tenants unless the key and authorization model explicitly represent a platform-level aggregate. The MVP should not use platform-level aggregates for tenant business data.

The main trade-offs are invalidation complexity, stale reads, memory pressure, eviction behavior, and another operational dependency. Redis outages should degrade performance and increase PostgreSQL read load, not corrupt or lose authoritative business state. The service must be able to bypass Redis temporarily when it is unavailable.

Redis must never become the system of record for case workflow, audit trail, idempotency, GL coding, or identity. Redis values are derived and rebuildable, and deleting the cache must not delete business state.

## Cross-Datastore Rules

- PostgreSQL remains the authoritative source for `Expense Report` state.
- Redis values are derived, disposable, and rebuildable from PostgreSQL.
- DynamoDB idempotency records coordinate duplicate-request handling but do not replace PostgreSQL transactions.
- No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis.
- Failure handling must define which datastore operation is authoritative and which operations may be retried, expired, invalidated, or repaired.
- Every key, query, record, and invalidation design must preserve tenant isolation.
- Request bodies are not trusted for tenant isolation; tenant context comes from authenticated identity.
- Cross-datastore records may reference stable identifiers, but they must not duplicate another datastore's authoritative records as a second source of truth.

## Consequences

This decision keeps durable domain state, operational request coordination, and disposable read optimization separate. It lets each storage technology serve the access pattern it is best suited for while preserving a clear source-of-truth model.

Application code must be explicit about write ordering and recovery. For example, a write command may first claim a DynamoDB idempotency key, then perform the authoritative PostgreSQL transaction, then invalidate Redis. If Redis invalidation fails after PostgreSQL commits, the system should retry, expire, or repair the cache rather than rolling back the committed domain change. If PostgreSQL fails, the idempotency record must represent that the authoritative domain mutation did not complete or must allow a safe retry according to the idempotency contract.

Operationally, the team must monitor and manage PostgreSQL migrations and indexes, DynamoDB conditional-operation behavior and TTL, and Redis memory, eviction, and availability. Tests should cover tenant isolation and failure behavior using synthetic data only.

## Alternatives Considered

### PostgreSQL for all state

Using PostgreSQL for case state, idempotency records, and cache entries would reduce infrastructure variety. This was rejected because request retry coordination and disposable cache data have different lifecycle and access patterns from durable workflow state. Storing all of it in PostgreSQL would increase table churn and mix operational concerns into the domain store.

### DynamoDB as the primary case store

DynamoDB could scale key-based case lookups and conditional writes, but it does not naturally fit the relational integrity, multi-row workflow transactions, audit-related joins, migration review, and tenant-scoped query needs of the Core Case Service. It would also make ad hoc review workflows and relational constraints harder.

### Redis as a shared state layer

Redis can provide fast reads and simple coordination primitives, but it is not appropriate as the system of record for ExpenseFlow business data. Eviction, memory pressure, TTL expiration, and outage behavior make it a poor fit for durable case state, audit records, or idempotency history that must survive cache loss.

### Distributed transactions across datastores

Coordinating PostgreSQL, DynamoDB, and Redis through distributed transactions was rejected because it would add operational complexity and failure modes that are not necessary for the MVP. ExpenseFlow will instead define authoritative writes, retryable coordination records, cache invalidation, TTLs, and repair paths.
