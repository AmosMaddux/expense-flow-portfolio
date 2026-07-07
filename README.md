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

Utility function to run linter, typing, and test checks:

```sh
make
```

## PostgreSQL setup

Migrations are located in [backend/core-case-service/drizzle](backend/core-case-service/drizzle). They can be applied with ``drizzle-kit migrate``

Rollbacks for each migration are located in [backend/core-case-service/drizzle/rollback](backend/core-case-service/drizzle/rollback). These are manually applied and maintained.

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
