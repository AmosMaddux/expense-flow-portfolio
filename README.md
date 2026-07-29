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
uv run --env-file .env uvicorn backend.python.main:app --port 8001
```

The local Docker Compose stack starts this service automatically on port `8001`
and seeds the baseline GL mappings for the tenant configured by
`VITE_TENANT_ID`. Start the shared local dependencies before the Core Case
Service:

```sh
docker compose up -d
npm start
```

The mapping initializer waits for the Core Case migrations and is idempotent, so
these commands are safe to run again after switching branches.

### Inspect local stage-transition events

The Compose stack also starts LocalStack with an SNS topic named
`expenseflow-stage-transitions-local` and a raw-delivery SQS subscription. Copy
the stage-transition settings from `.env.example` into `.env`, restart the Core
Case Service, and perform a successful Expense Report transition in the UI.

Read the queued CloudEvent from another terminal:

```sh
npm run dev:events:receive
```

The command long-polls for up to ten seconds and prints the CloudEvent body plus
its `correlationId` and `eventType` SNS message attributes. Receiving a message
temporarily hides it but does not delete it, so it can appear again after the
SQS visibility timeout. Use the UI to perform another successful transition
when you want a fresh event.

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

The Core Case Vitest integration suite includes a cross-service submission test that starts the FastAPI GL-coding service with `uv run uvicorn`. The workspace test script runs `uv sync --project ../..` first so the Python runtime dependencies are present before Vitest starts:

```sh
npm --workspace backend/core-case-service test
```

For a TypeScript-only Core Case run that excludes the cross-service FastAPI integration test, use:

```sh
npm --workspace backend/core-case-service run test:node-only
```

Utility function to run linter, typing, and test checks:

```sh
make
```

## Frontend App Shell

The React 18 + Vite TypeScript app shell lives in [frontend/app](frontend/app). It provides the persistent top bar and sidebar frame for future operator and employee portal screens.

Build all production TypeScript and frontend output with one command:

```sh
npm run build
```

The frontend production bundle is generated at `frontend/app/dist`.

## Playwright E2E

The ExpenseFlow happy-path browser test drives the real login, Employee
submission, Department Manager approval, and persisted queue state through the
React UI. Use only the synthetic E2E tenant and accounts documented here.

Prerequisites:

- Node.js 24 or newer and npm.
- Python 3.13 and `uv`.
- Docker with Compose support.
- A local `.env` file with synthetic development values. Start from
  `.env.example`, then generate local JWT keys:

    ```sh
    cp .env.example .env
    ./scripts/generate-dev-jwt-keys.sh
    ```

Install dependencies and the Chromium browser:

```sh
npm ci
uv sync
npx playwright install chromium
```

On Linux machines that need browser system packages, use:

```sh
npx playwright install --with-deps chromium
```

Reset and verify the deterministic E2E data without running the browser:

```sh
docker compose up -d --wait postgres
docker compose run --rm postgres-e2e-marker
npm run e2e:reset
npm run e2e:verify
```

The reset applies pending Core Case migrations, verifies the connection is the
dedicated synthetic E2E database, clears the hard-coded E2E tenant, and seeds:

- Employee: `employee.e2e@example.test`
- Department Manager: `manager.e2e@example.test`
- Default synthetic password: `expenseflow-e2e-local-only`

Override the password for a local run with `EXPENSEFLOW_E2E_PASSWORD`; do not use
real credentials. MFA codes are generated from the seeded local enrollment by the
test helper and can also be read with:

```sh
npm run e2e:auth:code -- employee
npm run e2e:auth:code -- manager
```

Run the Playwright E2E suite headlessly:

```sh
npm run test:e2e
```

That command starts PostgreSQL, Redis, and the FastAPI GL-coding service with
Docker Compose, waits for their health checks, resets and seeds E2E data, then
lets Playwright start the Express API and Vite frontend through configured
health-checked web servers. The suite includes the employee-to-manager
happy-path test plus axe scans for the Finance Dashboard, Approval Queue, and
Log Mileage screens.

Run only the axe accessibility scans:

```sh
npx playwright test tests/e2e/accessibility.spec.mjs
```

Run only the existing approval happy path:

```sh
npx playwright test tests/e2e/expense-report-approval.spec.mjs
```

Run the Lighthouse gate for the protected main operator screen:

```sh
npm run lighthouse
```

The Lighthouse command starts the required Docker services, resets the
deterministic E2E tenant, builds the frontend for production, starts the Express
API, serves `frontend/app/dist` through a local production-like preview/proxy,
and audits `/finance-dashboard` with Lighthouse CI. It performs three desktop
runs and fails if Performance or Accessibility is below `0.90`.

Run the complete local UI quality gate used by CI:

```sh
npm run test:ui-gate
```

Stop local containers after a run with:

```sh
docker compose down --volumes --remove-orphans
```

Run headed or with Playwright debug mode:

```sh
npm run test:e2e:headed
npm run test:e2e:debug
```

Playwright writes its HTML report to `playwright-report/`. Failure traces,
screenshots, videos, and axe JSON attachments are retained under
`test-results/`. Lighthouse HTML and JSON reports are written under
`test-results/lighthouse/`, with temporary LHCI working files under
`.lighthouseci/`. These generated paths are ignored locally and uploaded by CI
only when the UI quality gate fails.

CI runs the same `npm run test:ui-gate` command on pull requests and pushes to
`development` and `main`. The required GitHub check should be the
`UI quality gate` job in the `ExpenseFlow E2E` workflow.

## PostgreSQL setup

Migrations are located in [backend/core-case-service/drizzle](backend/core-case-service/drizzle). They can be applied with `drizzle-kit migrate`

If a migration needs to be undone, write and apply a new corrective migration rather than reverse-applying — this repo does not maintain manual down-migration scripts.

## Core Case Service API Contract

The Core Case Service OpenAPI contract is committed at [docs/openapi/core-case-service.openapi.json](docs/openapi/core-case-service.openapi.json). It is generated with `OpenApiGeneratorV31` from the service Zod DTO schemas and documents the active `POST /v1/expense-reports`, `GET /v1/expense-reports/{id}`, and `GET /v1/expense-reports/{id}/audit-entries` endpoints.

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

[docs/service-boundaries.md](docs/service-boundaries.md) defines which service owns `Expense Report` cases, GL coding, and identity, including each service's datastore and tenant-isolation strategy.

Future architecture decisions should be recorded as ADRs under `docs/adr/`. Name ADR files with the pattern `NNNN-short-title.md`, such as `0001-tenant-isolation.md`.

ADRs must use synthetic examples only and follow [AGENTS.md](AGENTS.md) plus the data classification posture.

## PR Review Checklist

Before merging any PR, reviewers must apply the AI-augmented checklist in [docs/pr-review-checklist.md](docs/pr-review-checklist.md). It covers branch and PR conventions, ADR linkage, tenant isolation, authorization, workflow rules, input validation, audit-trail impact, and prohibited plaintext logging for receipt and payment data.

## Contribution Workflow

ExpenseFlow uses a protected `main`, a `development` integration branch, and short-lived `feature/*` and `hotfix/*` branches with pull-request review for every change. Planned work flows from `feature/*` to `development`, and `development` merges directly to `main` through a reviewed pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, PR conventions, ADR requirements, and review expectations.

## Governance Links

- [Agent contract](AGENTS.md)
- [Contributing guide](CONTRIBUTING.md)
- [Data classification posture](docs/data-classification.md)
- [Service ownership boundaries](docs/service-boundaries.md)
- [PR review checklist](docs/pr-review-checklist.md)
- [ADR 0001: Store Expense Report Case records in PostgreSQL](docs/adr/0001-expense-report-case-postgresql.md)
- [Codex configuration](config.toml)
- ADR convention: record future decisions under `docs/adr/` using `NNNN-short-title.md`
