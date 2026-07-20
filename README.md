# ExpenseFlow

ExpenseFlow is a multi-tenant expense and reimbursement workflow app for corporate finance teams. It manages each `Expense Report` as a case through employee submission, manager approval, AP review, payment stub, and reconciliation, producing clean GL-ready records with an immutable audit trail.

## Core Workflow

Expense Reports move through six stages: `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`, and `Reconciled`.

The current stage is the source of truth for the case condition. There is no separate status field. Rejections at `Manager Approval` or `AP Review` return the case to `Drafted`, and `Reconciled` is the terminal stage.

## Roles

ExpenseFlow separates internal finance workspaces from the external employee portal:

- `Finance Admin`: oversees workspace settings, users, GL mapping, policy text, case auditability, and second-pair review.
- `Department Manager`: approves or rejects line items, clears flags, verifies AP coding, marks deductibility, issues the payment stub, and reconciles the case.
- `Employee`: submits expenses or contractor-style invoices, uploads receipts, logs mileage, tracks their own cases, disputes, and comments.
- `Admin`: platform operator role for the ExpenseFlow vendor, with no tenant impersonation in the MVP.

## MVP Boundaries

The MVP includes multi-tenant isolation, an immutable audit trail, email and password authentication with MFA, a hard-coded flag threshold such as line items over `$500`, manual deductibility, and a payment stub.

The MVP does not include SSO, SAML, OIDC, magic links, tenant impersonation, anomaly detection, automated deductibility classification, a general ledger system, SLA timers, escalation routing, or a separate overdue queue.

## Agent Contract

[AGENTS.md](AGENTS.md) is the repository-level instruction file for Codex and other AI agents working in ExpenseFlow. It defines the rules agents must follow before generating code, tests, examples, documentation, or operational output.

The contract covers:

- Data handling rules for controlled data, production data, secrets, and synthetic fixtures.
- Only allowed application stacks: TypeScript with Express and Python with FastAPI.
- Required versions for pinned technologies: Python 3.13, React 18, and pydantic v2.
- Product workflow, case model, roles, tenant boundaries, authorization expectations, and MVP limits.
- Forbidden technologies outside those stacks, including Java, Spring, JPA, and MongoDB.
- Git branch, commit, push, and CI/CD governance.
- Forbidden product scope, including payroll, tax filing, procurement, inventory, travel booking, banking, card issuing, general ledger systems, SSO, tenant impersonation, anomaly detection, and SLA automation.

## Clean-Clone Setup

From a clean clone, a new engineer should reach a governed Codex session with these steps:

1. Clone the repository.

    ```sh
    git clone <repo-url>
    cd expense-flow-project-team-3
    ```

2. Confirm the repository governance files are present.

    ```sh
    test -f AGENTS.md
    test -f docs/data-classification.md
    test -f config.toml
    ```

3. Review the agent contract before asking Codex to change files.

    Read [AGENTS.md](AGENTS.md). It defines the allowed stacks, required technology versions, forbidden stacks, data-handling rules, ExpenseFlow workflow and roles, Git governance, and forbidden product scope.

4. Review the data classification posture.

    Read [docs/data-classification.md](docs/data-classification.md). It defines the PUBLIC, CUI, and SBU data buckets; tenant isolation expectations; least-privilege expectations; and payment-data logging restrictions.

5. Review the local Codex configuration.

    Read [config.toml](config.toml). It defines the local Codex model reasoning effort, sandbox mode, and approval policy for this repository.

6. Start Codex from the repository root so it can load the local contract, data posture, and configuration.

    ```sh
    codex
    ```

7. In the Codex session, verify the working directory is this repository and that requests follow the contract.

    ```sh
    pwd
    git status --short
    ```

8. Use only synthetic data in prompts, examples, tests, fixtures, logs, and documentation. Do not paste real customer data, production data, payment data, bank-feed transaction data, credentials, tokens, API keys, or private identifiers into Codex.

## Python Setup

Create the project virtual environment from the committed dependency files with:

```sh
uv sync
```

This creates a local `.venv/` directory. The virtual environment itself is intentionally not committed because it is machine-specific; `pyproject.toml` and `uv.lock` are the shareable source of truth for other developers after push.

Use `uv run [command]` to run commands using the Python virtual environment. Ex:

```sh
uv run backend/python/main.py
```

To run the fastapi service use:

```sh
uv run uvicorn backend.python.main:app
```

Run tests with:

```sh
uv run pytest
```

The Python provider Pact tests also require the checked-in Node lockfile dependency that provides `node_modules/.bin/pact-verifier`. On a clean checkout, install both Python and Node dependencies before running the full pytest suite:

```sh
uv sync
npm ci
uv run pytest
```

To run only the provider Pact tests with the same reproducible setup CI should use:

```sh
npm run ci:provider
```

Utility function to run linter, typing, and test checks:

```sh
make
```

## PostgreSQL setup

Migrations are located in [backend/core-case-service/drizzle](backend/core-case-service/drizzle). They can be applied with ``drizzle-kit migrate``

If a migration needs to be undone, write and apply a new corrective migration rather than reverse-applying — this repo does not maintain manual down-migration scripts.
## Core Case Service API Contract

The Core Case Service OpenAPI contract is committed at [docs/openapi/core-case-service.openapi.json](docs/openapi/core-case-service.openapi.json). It is generated with `OpenApiGeneratorV31` from the service Zod DTO schemas and documents the active `POST /v1/expense-reports` and `GET /v1/expense-reports/{id}` endpoints.

All public Core Case Service endpoints are versioned under `/v1`. Within a published API version, a response or request field is never removed or given incompatible semantics without first marking it `deprecated: true` in OpenAPI and adding a migration note to its schema description. Deprecated fields remain supported for the lifetime of that API version; removal or an incompatible change requires a new URL version.

Generate the committed contract from the Core Case Service workspace with:
```sh
npm run openapi:generate --workspace backend/core-case-service
```

When the Express service is running, the same generated contract is served at:
```text
GET /v1/openapi.json
```

Interactive OpenAPI documentation is rendered with `@scalar/express-api-reference` from the same contract at:
```text
GET /v1/docs
```

## Core Case Persistence Smoke Test

Use these commands to verify that `POST /v1/expense-reports` persists an Expense Report, audit entry, and initial stage transition in a local Docker PostgreSQL database. Use only synthetic IDs and dates.

The local `.env` file is ignored by Git and contains synthetic Docker PostgreSQL values plus `AUTO_APPLY_MIGRATIONS=true` for this smoke test.

```sh
test -f .env
```

Start PostgreSQL:

```sh
docker run -d \
  --name expenseflow-postgres-dev \
  --env-file .env \
  -p 55432:5432 \
  postgres:17-alpine
```

Run the Core Case Service against the Docker database. This command builds the TypeScript service, loads `.env`, applies the checked-in Drizzle migrations, and starts the API:

```sh
npm start
```

From another shell, mint a short-lived access token with the service's local signing key. The synthetic Employee identity must match the Expense Report owner:

```sh
export EXPENSEFLOW_TENANT_ID="40000000-0000-4000-8000-000000000300"
export EXPENSEFLOW_EMPLOYEE_ID="50000000-0000-4000-8000-000000000300"
export EXPENSEFLOW_ACCESS_TOKEN="$(node --env-file=.env --input-type=module -e 'import { signAccessToken } from "./backend/core-case-service/dist/auth/shared/accessTokenSigner.js"; import { loadAuthJwtConfig } from "./backend/core-case-service/dist/config/authJwtConfig.js"; const { accessToken } = signAccessToken({ tenantId: process.env.EXPENSEFLOW_TENANT_ID, userId: process.env.EXPENSEFLOW_EMPLOYEE_ID, roles: ["Employee"] }, loadAuthJwtConfig(), new Date()); process.stdout.write(accessToken);')"
```

Create a synthetic Expense Report through the authenticated API. Mint another token if the short-lived token expires during the smoke test:

```sh
curl -sS -X POST http://127.0.0.1:3301/v1/expense-reports \
  -H "authorization: Bearer ${EXPENSEFLOW_ACCESS_TOKEN}" \
  -H "content-type: application/json" \
  -d "{
    \"owner\": \"${EXPENSEFLOW_EMPLOYEE_ID}\",
    \"dueDate\": \"2026-08-14\",
    \"priority\": \"High\"
  }"
```

Set `EXPENSEFLOW_REPORT_ID` to the returned `id`, then verify the persisted rows:

```sh
export EXPENSEFLOW_REPORT_ID="<returned-report-id>"
curl -sS "http://127.0.0.1:3301/v1/expense-reports/${EXPENSEFLOW_REPORT_ID}" \
  -H "authorization: Bearer ${EXPENSEFLOW_ACCESS_TOKEN}"
```

```sh
node --env-file=.env --input-type=module -e "import { Pool } from 'pg'; const pool = new Pool({ connectionString: process.env.DATABASE_URL }); try { const report = await pool.query('select id, tenant_id, owner, due_date, priority, current_stage, on_hold from expense_report where id = \$1', [process.env.EXPENSEFLOW_REPORT_ID]); const audit = await pool.query('select action, stage_before_action, stage_after_proposed_action from audit_entry where expense_report_id = \$1', [process.env.EXPENSEFLOW_REPORT_ID]); const transition = await pool.query('select from_stage, to_stage, actor, reason from stage_transition where expense_report_id = \$1', [process.env.EXPENSEFLOW_REPORT_ID]); console.log(JSON.stringify({ report: report.rows, audit: audit.rows, transition: transition.rows }, null, 2)); } finally { await pool.end(); }"
```

Stop the local database when finished:

```sh
docker stop expenseflow-postgres-dev
docker rm expenseflow-postgres-dev
```

## Posture and ADR Conventions

[docs/data-classification.md](docs/data-classification.md) is the repository posture note. It defines data buckets, tenant isolation, least privilege, and payment-data handling obligations for later sprints.

Future architecture decisions should be recorded as ADRs under `docs/adr/`. Name ADR files with the pattern `NNNN-short-title.md`, such as `0001-tenant-isolation.md`.

ADRs must use synthetic examples only and follow [AGENTS.md](AGENTS.md) plus the data classification posture.

## PR Review Checklist

Before merging any PR, reviewers must apply the AI-augmented checklist in [docs/pr-review-checklist.md](docs/pr-review-checklist.md). It covers branch and PR conventions, ADR linkage, tenant isolation, authorization, workflow rules, input validation, audit-trail impact, and prohibited plaintext logging for receipt and payment data.

## Contribution Workflow

ExpenseFlow uses a protected `main`, a `develop` integration branch, and short-lived `feature/*`, `release/*`, and `hotfix/*` branches with pull-request review for every change. See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, CI/CD pipeline conventions, PR conventions, ADR requirements, and review expectations.

## Governance Links

- [Agent contract](AGENTS.md)
- [Contributing guide](CONTRIBUTING.md)
- [Data classification posture](docs/data-classification.md)
- [PR review checklist](docs/pr-review-checklist.md)
- [ADR 0001: Store Expense Report Case records in PostgreSQL](docs/adr/0001-expense-report-case-postgresql.md)
- [Codex configuration](config.toml)
- ADR convention: record future decisions under `docs/adr/` using `NNNN-short-title.md`
