# Contributing

ExpenseFlow uses a protected main branch, a develop integration branch, and short-lived working branches with pull-request review for every change. These rules reflect the team branch and release conventions. Keep changes small, focused, and easy to review.

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
- Confirm the AI code-review checklist in [docs/pr-review-checklist.md](docs/pr-review-checklist.md) was completed.

If a PR changes an architectural decision, tenant boundary, workflow contract, authorization model, data classification posture, or technology choice, it must link the relevant ADR under `docs/adr/`. New ADRs should use the filename pattern `NNNN-short-title.md`.

## Commit Messages

Commit messages must contain a short message stating what changed or was accomplished.

Use one commit per meaningful change. Do not combine unrelated changes in one commit.

## Main Branch

`main` is the production branch and contains the current stable version of the app.

- Required before merge: full test suite, security scanning, deployment approval, and smoke-test plan are complete.
- Protection: requires PR approval, allows no direct commits, and accepts PRs only from `release/*` or `hotfix/*` branches.
- Deployment: production deployment requires an approval gate and post-deploy smoke tests.
- Cadence: review `develop` after every sprint to decide whether a merge to `release/*` and `main` is ready.

Agents and engineers must not commit directly to `main` or push directly to `main`.

## Develop Branch

`develop` is the development and staging branch and contains the most recent version of the app.

- Required before merge: full test suite and code quality checks pass, including linting and at least 80% coverage.
- Protection: requires PR approval.

## Feature Branches

`feature/*` branches are sandbox branches for new feature work.

- Branched from: `develop`.
- Merged to: `develop`.
- Naming convention: `feature/<JIRA TICKET ID>`, such as `feature/SCRUM-18`.
- Prerequisite: unit tests are written and passing locally before push.
- Required before merge: full test suite and code quality checks pass, including linting and at least 80% coverage.

## Release Branches

`release/*` branches are pre-production branches created to test a full version of the app and fix bugs before deploying to `main`.

- Branched from: `develop`.
- Merged to: `develop` and `main`.
- Naming convention: `release/<APP NAME>/v<VERSION_NUMBER>`, such as `release/expenseflow/v1.0.0`.
- Required before merge: full test suite, security audit, QA testing window, and pre-production deployment are complete.

## Hotfix Branches

`hotfix/*` branches are used exclusively for urgent production issues.

- Branched from: `main` or the active `release/*` branch.
- Merged to: `main` and `develop`.
- Naming convention: `hotfix/<APP NAME>/v<VERSION_NUMBER>.<PATCH_NUMBER>` or `hotfix/<JIRA TICKET ID>`, such as `hotfix/expenseflow/v1.0.1` or `hotfix/SCRUM-18`.
- Required before merge: targeted tests, regression suite, security check, and staging validation are complete.
- Deployment: hotfixes may use an expedited deployment path to staging.
- SLA: review within 6 hours of PR creation and make requested changes within 12 hours of review.
- Escalation: if the 6-hour review window is missed, send a direct message reminder for PR review.

## Branch Name Data Handling

Branch names must not expose customer, tenant, employee, payment, receipt, credential, or private identifier data. Use Jira ticket IDs and product-safe app names instead.

## Review Expectations

Reviewers must apply [docs/pr-review-checklist.md](docs/pr-review-checklist.md) before approving a pull request. AI-assisted review is encouraged, but the human reviewer remains accountable for validating tenant isolation, authorization, auditability, data handling, and workflow behavior.
