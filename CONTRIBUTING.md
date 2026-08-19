# Contributing

ExpenseFlow uses a protected `main` branch, a `development` integration branch, and short-lived working branches with pull-request review for every change. Keep changes small, focused, and easy to review.

## Pull Requests

Every pull request must use the repository PR template in `.github/pull_request_template.md`.

Pull requests must:

- Link the Jira ticket in the PR.
- In general, map to one Jira ticket.
- Reference every related Jira ticket when several tickets describe the same issue or body of work.
- Include a concise summary of the change.
- Include the service area, such as `Core Case Service`.
- Include test evidence or a clear explanation when tests are not applicable.
- Include data-handling notes when the change touches logs, fixtures, generated output, documents, receipts, payment data, tenant data, or private identifiers.
- Follow the commenting policy in `AGENTS.md` for public docstrings/JSDoc and intentional inline comments.
- Confirm the AI code-review checklist in [docs/pr-review-checklist.md](docs/pr-review-checklist.md) was completed.
- Follow [the secure PR gate suppression process](docs/secure-pr-gate-suppressions.md) for every vetted scanner false positive or time-bounded risk acceptance.

If a PR changes an architectural decision, tenant boundary, workflow contract, authorization model, data classification posture, or technology choice, it must link the relevant ADR under `docs/adr/`. New ADRs should use the filename pattern `NNNN-short-title.md`.

## Commit Messages

Commit messages must contain a short message stating what changed or was accomplished.

Use one commit per meaningful change. Do not combine unrelated changes in one commit.

## Main Branch

`main` is the production branch and contains the current stable version of the app.

- Required before merge: the full test suite and code quality checks pass, including linting and at least 80% coverage.
- Protection: requires PR approval, allows no direct commits, and accepts PRs from `development` or `hotfix/*` branches.
- Cadence: review `development` after every sprint and open a pull request directly to `main` when it is ready.
- No intermediate release branch or separate release-evidence package is required.

Agents and engineers must not commit directly to `main` or push directly to `main`.

## Development Branch

`development` is the integration branch and contains the most recent version of the app.

- Required before merge: full test suite and code quality checks pass, including linting and at least 80% coverage.
- Protection: requires PR approval.
- Promotion: merges directly to `main` through a reviewed pull request.

## Feature Branches

`feature/*` branches are sandbox branches for new feature work.

- Branched from: `development`.
- Merged to: `development`.
- Naming convention: `feature/<JIRA TICKET ID>`, such as `feature/SCRUM-18`.
- Prerequisite: unit tests are written and passing locally before push.
- Required before merge: full test suite and code quality checks pass, including linting and at least 80% coverage.

## Hotfix Branches

`hotfix/*` branches are used exclusively for urgent production issues.

- Branched from: `development` when stabilizing changes not yet in `main`, or `main` when correcting the current production version.
- Merged to: `main`; fixes created from `main` must also be merged back to `development`.
- Naming convention: `hotfix/v<VERSION_NUMBER>` or `hotfix/<JIRA TICKET ID>`, such as `hotfix/v1.0.2` or `hotfix/SCRUM-18`.
- Required before merge: targeted tests and the full regression and code quality checks pass, including linting and at least 80% coverage.
- SLA: review within 6 hours of PR creation and make requested changes within 12 hours of review.
- Escalation: if the 6-hour review window is missed, send a direct message reminder for PR review.

## Database Migrations

Database migrations are forward-only. Matching rollback scripts are not required; corrections to an applied migration must be delivered as a new forward migration.

## Branch Name Data Handling

Branch names must not expose customer, tenant, employee, payment, receipt, credential, or private identifier data. Use Jira ticket IDs and product-safe app names instead.

## Review Expectations

Reviewers must apply [docs/pr-review-checklist.md](docs/pr-review-checklist.md) before approving a pull request. AI-assisted review is encouraged, but the human reviewer remains accountable for validating tenant isolation, authorization, auditability, data handling, and workflow behavior.
