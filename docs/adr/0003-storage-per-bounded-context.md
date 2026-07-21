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

- `Expense Report` state is stored in PostgreSQL.
- Durable idempotency records are stored in DynamoDB.
- Case Queue, application cache, and short-lived idempotency cache entries are stored in Redis.

No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis. Each write path must define which datastore operation is authoritative, which operations are request-coordination or cache operations, and which operations may be retried, expired, invalidated, or bypassed after failure.

## PostgreSQL: Core Case, GL, Identity, and Rate-Limit State

PostgreSQL is the authoritative system of record for active Core Case Service case data. This includes `Expense Report` cases, line items, mileage entries, comments, attachment and receipt metadata references, `current_stage`, `on_hold`, `hold_reason`, audit trail entries, stage-transition log records, and GL-coding result history attached to an expense report.

The MVP also stores GL reference tables, Identity/Auth tables, and tenant rate-limit windows in the same Core Case PostgreSQL deployment. The `gl_code`, `gl_mapping`, and `gl_coding_result` tables are physically in PostgreSQL while GL Coding remains a separate ownership boundary. The `user`, `credential`, `role`, `refresh_token`, `mfa_enrollment`, and `authentication_audit_entry` tables are physically in PostgreSQL while Identity remains a separate ownership boundary. `tenant_rate_limit_window` is operational counter state, not durable case domain state.

PostgreSQL fits these responsibilities because the active Core Case Service needs strong transactional consistency, relational constraints, referential integrity, and multi-row transactions where a workflow mutation must update case state and write audit-related records together. The service also needs queryable state for Case Queue rollups and lists, Case Detail, Employee Portal status, and review workflows.

The expected consistency model is strong consistency within PostgreSQL transactions. Workflow mutations use PostgreSQL transactions where related case, audit, stage-transition, and GL-coding-result changes must commit or roll back together. `current_stage` remains the source of truth for case condition, and audit-related records are committed with the authoritative domain change where applicable.

Tenant isolation is enforced through mandatory `tenant_id` scoping in tables, constraints, repository methods, and service queries. Case-owned child tables carry tenant scope and enforce it through composite relationships to the `Expense Report` aggregate. GL and Identity tables also carry tenant scope directly or through tenant-scoped relationships. Request bodies are not trusted for tenant isolation; tenant scope comes from authenticated identity and must be present on reads, writes, tests, and migrations that affect tenant-scoped data.

The main trade-offs are explicit schema migrations, relational scaling limits, index management, and careful transaction design. The team must review migrations, indexes, locks, and query plans as case volume grows. Those costs are acceptable because durable workflow state needs reviewable constraints and consistent updates more than flexible key-value access.

PostgreSQL must not become a dumping ground for Redis-style disposable cache entries or DynamoDB idempotency records. It may store operational state when the current code intentionally uses PostgreSQL semantics, such as atomic tenant rate-limit counters. It also must not store duplicate authoritative copies of GL Coding Service or Identity Service records beyond the MVP tables explicitly assigned to those service ownership boundaries.

Redis and DynamoDB must not become authoritative sources for active `Expense Report` state. Case Queue data is derived from PostgreSQL, and PostgreSQL remains the source from which that value can be verified or rebuilt.

## DynamoDB: Idempotency Records

DynamoDB stores durable idempotency records used to prevent duplicate processing of retried write requests. These records coordinate request handling for idempotent create and submit commands in the current codebase, but they are not authoritative `Expense Report` domain state.

Idempotency records use tenant-scoped partition keys in the format `idem:{tenantId}:{idempotencyKey}`. Stored records include the request hash, status of `in_progress` or `completed`, a TTL, and when applicable a submission token and completed response result.

Redis also holds tenant-scoped idempotency cache entries for the same idempotency key, such as short-lived locks or cached completed responses, to reduce repeated DynamoDB reads and coordinate concurrent retries. The Redis lock answers "is a request attempt for this key running right now?" while the DynamoDB record answers "has this key been reserved or completed, and what result should later retries observe?" DynamoDB remains the durable idempotency store; Redis entries are accelerators that can expire, be evicted, or be rebuilt from DynamoDB and the authoritative PostgreSQL outcome.

DynamoDB fits this responsibility because idempotency lookups are access-pattern-first: the service needs fast lookup by a deterministic tenant-scoped idempotency key and atomic create-if-absent behavior. Conditional `Put`, `Update`, and `Delete` operations allow one request attempt to reserve a key, complete it only with the matching submission token and request hash, and clear only the matching in-progress reservation after failure. TTL expiration removes old request-coordination records without requiring long-term domain retention.

The expected consistency model is conditional-write consistency around the idempotency key. The current code uses default read behavior and does not request a read-consistency override; conditional DynamoDB writes are the primary correctness control, and Redis locks serialize concurrent attempts before the durable reservation is written.

Tenant isolation is enforced by including `tenant_id` in the partition-key design, or by an equivalent key design that makes cross-tenant key collisions impossible. Idempotency keys supplied by clients must be scoped to the authenticated tenant before storage or lookup, so two tenants using the same client-provided key cannot affect each other.

The main trade-offs are eventual consistency defaults, limited ad hoc querying, AWS-specific operational complexity, capacity planning, and schema design that must start from known access patterns. TTL deletion is not immediate, so application logic must tolerate expired records remaining visible for a period.

DynamoDB must not store authoritative expense-report fields, workflow stage, audit trail, GL coding output, identity records, or active cache projections. It coordinates duplicate-request handling but does not replace PostgreSQL transactions. A successful idempotency reservation only permits the service to attempt the authoritative PostgreSQL mutation; the completed result is saved after that mutation succeeds.

There is a known recovery gap between PostgreSQL commit and DynamoDB completion. In the current flow, the authoritative PostgreSQL mutation can commit before the service marks the DynamoDB idempotency record `completed`. If that DynamoDB completion write fails, the key can remain `in_progress` until its TTL expires. After expiration, a retry with the same idempotency key may be able to reserve the key again and repeat an authoritative mutation, especially for create operations. Redis locks and DynamoDB TTLs do not close this gap; they only coordinate concurrent attempts and eventually clear stale request-coordination records.

The repository currently contains a DynamoDB-backed Expense Report case-store module, but it is not wired into the default Case Queue service and is not the authoritative source for active case data. The default Case Queue path reads through Redis when configured and otherwise falls back to PostgreSQL.

## Redis: Case Queue and Application Caching

Redis stores derived, disposable cache entries such as Case Queue rollups, idempotency result cache entries, short-lived idempotency locks, and other application cache values. These values exist to reduce read latency, reduce repeated DynamoDB reads, or coordinate concurrent request attempts, not to define business state.

Redis fits this responsibility because cache-aside access supports common queue reads when `REDIS_URL` is configured: the service checks Redis for a tenant-scoped Case Queue rollup entry, falls back to PostgreSQL on a miss, and repopulates Redis with a derived value. If Redis is not configured, the default Case Queue service reads directly from PostgreSQL. Stage transitions invalidate tenant rollups by incrementing a tenant-scoped cache-version key, and rollup entries have a configurable TTL that defaults to 30 seconds.

Redis idempotency locks use tenant-scoped keys in the format `lock:{tenantId}:{idempotencyKey}` with a 30-second TTL. They are short-lived concurrency guards only: losing a lock may allow a later attempt to compete for the DynamoDB reservation, but it must not erase request history or a completed response. Redis idempotency result entries use tenant-scoped keys in the format `idem:{tenantId}:{idempotencyKey}`, mirror completed DynamoDB results, and expire using the remaining DynamoDB TTL.

The expected consistency model is eventual consistency with bounded staleness for derived application reads and best-effort acceleration for idempotency cache entries. A Case Queue cache hit may briefly return a stale derived view after a write, but tenant-version invalidation and TTLs bound staleness and the authoritative state remains in PostgreSQL. Cache misses, expired entries, evicted entries, and rebuilds fall back to PostgreSQL for case data or DynamoDB for durable idempotency records.

Tenant isolation is enforced through tenant-scoped cache keys. Cache keys must include authenticated tenant context or an equivalent tenant-isolating prefix, and cached values must not combine data from multiple tenants unless the key and authorization model explicitly represent a platform-level aggregate. The MVP should not use platform-level aggregates for tenant business data.

The main trade-offs are invalidation complexity, stale reads, memory pressure, eviction behavior, and another operational dependency. Redis outages or missing Redis configuration should degrade Case Queue performance and increase PostgreSQL read load. Redis outages may also cause duplicate DynamoDB reads or in-progress idempotency coordination failures, but they must not corrupt or lose authoritative PostgreSQL business state or durable DynamoDB idempotency records.

Redis must never become the system of record for case workflow, audit trail, GL coding, or identity. Redis also must not become the durable store for request-retry history. Redis values are derived or short-lived and rebuildable, and deleting the cache must not delete business state or the durable idempotency record.

## Cross-Datastore Rules

- PostgreSQL remains the authoritative source for `Expense Report` state.
- PostgreSQL transactions cover related case, audit, stage-transition, and GL-coding-result writes; they do not span DynamoDB or Redis.
- Redis values are derived, disposable, and rebuildable from PostgreSQL or DynamoDB, depending on the storage concern.
- DynamoDB idempotency records coordinate durable duplicate-request handling but do not replace PostgreSQL transactions.
- Redis may cache idempotency locks and completed idempotent responses, but Redis cache loss must not remove the durable DynamoDB idempotency record or permit duplicate authoritative PostgreSQL mutations.
- No business workflow may require a distributed transaction across PostgreSQL, DynamoDB, and Redis.
- Failure handling must define which datastore operation is authoritative and which operations may be retried, expired, invalidated, or bypassed.
- Every key, query, record, and invalidation design must preserve tenant isolation.
- Request bodies are not trusted for tenant isolation; tenant context comes from authenticated identity.
- Cross-datastore records may reference stable identifiers, but they must not duplicate another datastore's authoritative records as a second source of truth.

## Consequences

This decision keeps durable domain state, operational request coordination, and disposable read optimization separate. It lets each storage technology serve the access pattern it is best suited for while preserving a clear source-of-truth model.

Application code must be explicit about write ordering and recovery. The current idempotent write flow checks Redis for a completed result, acquires a short-lived Redis lock, reserves the durable DynamoDB idempotency key, performs the authoritative PostgreSQL transaction, saves the completed result in DynamoDB, mirrors that result in Redis, and releases the Redis lock. If Redis invalidation or idempotency-result caching fails after PostgreSQL commits, the system should rely on TTLs, cache bypass, or another retry rather than rolling back the committed domain change. If PostgreSQL fails, the idempotency reservation must be cleared or expire so the request can be retried according to the idempotency contract. This does not resolve the PostgreSQL-success/DynamoDB-completion failure window described above.

Future remediation should choose one concrete recovery guarantee before relying on this pattern for higher-volume or higher-risk write paths. Viable options include a PostgreSQL idempotency ledger that stores a tenant-scoped operation key and replayable result in the same transaction as the authoritative mutation; a stable operation identifier with a PostgreSQL uniqueness constraint on the affected domain rows or operation table; an outbox or reconciliation path that records committed operations in PostgreSQL and repairs DynamoDB or Redis idempotency records asynchronously; or committed-result verification that checks PostgreSQL for evidence of the same committed request before rerunning a mutation after an expired or missing DynamoDB record.

Operationally, the team must monitor and manage PostgreSQL migrations and indexes, DynamoDB conditional-operation behavior and TTL, and Redis memory, eviction, and availability. Tests should cover tenant isolation, idempotency replay behavior, cache fallback behavior, and failure behavior using synthetic data only.

## Alternatives Considered

### PostgreSQL for all state

Using PostgreSQL for case state, durable idempotency records, and Redis-style cache entries would reduce infrastructure variety. This was rejected because request retry coordination and disposable cache data have different lifecycle and access patterns from durable workflow state. Storing all of it in PostgreSQL would increase table churn and mix idempotency and cache concerns into the domain store. PostgreSQL is still used for tenant rate-limit windows because the current implementation needs atomic per-tenant counters, not a rebuildable cache.

### DynamoDB as the primary case store

DynamoDB could scale key-based case lookups and conditional writes, but it does not naturally fit the relational integrity, multi-row workflow transactions, audit-related joins, migration review, and tenant-scoped query needs of the Core Case Service. It would also make ad hoc review workflows and relational constraints harder.

### Redis as a shared state layer

Redis can provide fast reads and simple coordination primitives, but it is not appropriate as the system of record for ExpenseFlow business data. Eviction, memory pressure, TTL expiration, and outage behavior make it a poor fit for durable case state, audit records, or idempotency history that must survive cache loss. Redis is acceptable as a short-lived idempotency cache because the durable record remains in DynamoDB.

### Distributed transactions across datastores

Coordinating PostgreSQL, DynamoDB, and Redis through distributed transactions was rejected because it would add operational complexity and failure modes that are not necessary for the MVP. ExpenseFlow will instead define authoritative PostgreSQL writes, DynamoDB idempotency records, Redis locks and caches, cache invalidation, TTLs, and fallback paths.
