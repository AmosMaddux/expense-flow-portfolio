# ExpenseFlow Service Boundaries

ExpenseFlow separates case workflow, GL coding, and identity into explicit service ownership boundaries. Each service owns its datastore, tenant-isolation controls, and public contracts for its domain. Services may reference identifiers owned by another service, but they must not duplicate another service's source-of-truth records.

## Core Case Service

The Core Case Service owns the `Expense Report` case aggregate and the case-management workflow used by internal finance users and Employee Portal users.

### Owned Capabilities

- `Expense Report` identity, owner, assigned owner, due date, priority, `current_stage`, `on_hold`, and `hold_reason`.
- Stage transitions across `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`, and `Reconciled`.
- Backward transitions to `Drafted` for rejections at `Manager Approval` and `AP Review`.
- Comments, attachment metadata, receipt metadata references, audit trail entries, and stage-transition log records.
- Payment stub reference and case-level reconciliation state.
- Role-gated case actions for `Finance Admin`, `Department Manager`, and `Employee` workflows.

### Datastore

The Core Case Service stores case records in PostgreSQL and manages schema changes with Drizzle migrations under `backend/core-case-service/drizzle`.

### Tenant Isolation

Core Case Service tables carry tenant scope directly or through required relationships to the `Expense Report` aggregate. Repository methods must require authenticated tenant context for reads and writes. Request bodies are not trusted for tenant isolation; tenant scope is derived from authentication context and enforced in queries, authorization checks, and tests.

## GL Coding Service

The GL Coding Service owns AP coding rules, GL mapping reference data, and GL-ready coding outputs for expense line items. It does not own the `Expense Report` case lifecycle or identity records.

### Owned Capabilities

- Tenant-specific GL mapping reference data.
- AP coding inputs and outputs for expense line items.
- Manual deductibility markers used during `AP Review`.
- Coding validation results and GL-ready export records.
- MVP flag evaluation for hard-coded rules such as line items over `$500`.

### Datastore

The GL Coding Service logically owns the `gl_code` and `gl_mapping` reference tables. In the MVP, those tables physically live in the shared Core Case PostgreSQL deployment and are defined by the Drizzle schema in `backend/core-case-service/src/db/schema/expenseReport.ts`, with migrations under `backend/core-case-service/drizzle`, including `0009_gl_reference_seed.sql`. Python/FastAPI modules under `backend/python` read this tenant-scoped reference data through the GL mapping repository, but future schema or migration changes for `gl_code` and `gl_mapping` must be reviewed as GL Coding Service ownership changes.

### Tenant Isolation

GL Coding Service records must be scoped by tenant. Calls from the Core Case Service or other callers must pass tenant context derived from authenticated identity, not a tenant supplied by an untrusted request body. GL coding queries must filter by tenant and must not expose mapping, coding, deductibility, or flag data across tenants.

## Identity Service

The Identity Service owns tenant identity, user identity, credentials, MFA enrollment, role assignments, and token issuance or verification contracts. It does not own case workflow records or GL coding records.

### Owned Capabilities

- Tenant records and tenant membership.
- User identity records for `Finance Admin`, `Department Manager`, `Employee`, and platform `Admin`.
- Email and password authentication with MFA.
- Credential hashes, MFA secrets, refresh tokens, and access-token claims.
- Role and tenant claims used by service authorization.

### Datastore

The Identity Service owns identity and authentication tables. During the MVP, these tables may live in the Core Case Service PostgreSQL deployment while remaining a separate ownership boundary under `backend/core-case-service/src/db/schema/identityAuth.ts`.

### Tenant Isolation

Identity Service authentication establishes the tenant and role context used by downstream services. Tenant membership and role claims must be validated before issuing tokens. Platform `Admin` users must not impersonate tenant users in the MVP. Downstream services must treat Identity Service claims as the source of tenant context and must still enforce tenant-scoped repository access locally.

## Cross-Service Rules

- `Expense Report` case state belongs to the Core Case Service.
- GL coding, mapping, deductibility, and GL-ready export ownership belongs to the GL Coding Service.
- Tenants, users, roles, credentials, MFA, and token contracts belong to the Identity Service.
- Cross-service references use stable synthetic-safe identifiers and must not copy another service's owned records as a second source of truth.
- Every public request shape remains validated with Zod in TypeScript services or pydantic v2 in Python services.
- Service logs, tests, fixtures, examples, and documentation must use synthetic data only.
