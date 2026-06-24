# ExpenseFlow Agent Contract

These rules apply to all work in this repository.

## Product Context

- ExpenseFlow Corporate is a multi-tenant SaaS product for mid-to-large corporate finance teams.
- The target buyer is a corporate finance team at an organization with roughly 500 to 25,000 employees.
- ExpenseFlow turns employee expenses into clean GL entries and audit-defensible reimbursement records.
- The product is centered on case management, a multi-step workflow, and a split between internal staff workspaces and an external employee portal.

## Data Handling

- Follow the repository data classification posture in [docs/data-classification.md](docs/data-classification.md).
- Never place controlled data, production data, customer data, credentials, tokens, API keys, secrets, or private identifiers in prompts, generated code, logs, tests, fixtures, documentation, or output.
- When realistic data is needed, substitute a synthetic fixture that cannot identify a real person, organization, account, transaction, vendor, card, or system secret.
- If a request includes controlled data or secrets, refuse to repeat or transform those values and replace them with a clearly synthetic example.

## Language Standards

- The only allowed application stacks are TypeScript with Express and Python with FastAPI.
- Python services must target Python 3.13.
- Frontend React work must target React 18.
- Python data and API models must use pydantic v2.
- Any technology outside those stacks is forbidden for this project unless this agent contract is changed.
- Refuse to generate Java, Spring, JPA, or MongoDB code, configuration, schemas, migrations, examples, or scaffolds for this project.
- If asked for a forbidden stack, state that ExpenseFlow does not use that technology and provide an equivalent TypeScript/Express or Python/FastAPI implementation instead.

## Branch, Commit, and Push Rules

- Commit messages must be short, clear summaries of what changed or was accomplished.
- Use one commit per meaningful change.
- Do not combine unrelated changes in one commit.
- Agents must not commit directly to `main`.
- Agents must not push directly to `main`.
- Agents must not open pull requests into `main` from `feature/*` or `develop`.
- Planned work must flow from `feature/*` to `develop` to `release/*` to `main`.
- Normal planned changes must reach `main` only through a `release/*` branch.
- Urgent production fixes may flow through `hotfix/*` to `main`, then must be merged back to `develop`.

## ExpenseFlow Domain Vocabulary

- The primary case is `Expense Report`.
- Expense Report stages are `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`, and `Reconciled`.
- `Reconciled` is the terminal stage.
- There is no separate status field. Case condition lives in `current_stage`.
- A rejection at `Manager Approval` or `AP Review` is a backward transition to `Drafted`, not a stored status.
- Case pauses use `on_hold` and `hold_reason`, independent of workflow stage.
- Each case carries a unique ID, current stage, assigned owner, due date, priority, `on_hold`, attachments, comments, audit trail, and stage-transition log.
- Each Expense Report bundles transactions, receipts, mileage entries, submitter, approval chain, and payment ID.
- Tenant/internal roles are `Finance Admin` and `Department Manager`.
- The external role is `Employee`.
- The platform role is `Admin`.
- Generated code, tests, routes, models, and documentation should use these exact domain terms unless an existing file defines a narrower local convention.

## Roles and Authorization

- Internal users work from the Case Queue and Case Detail views.
- External users work from an Employee Portal scoped only to their own data.
- Role and tenant must drive UI visibility and API authorization.
- The top-bar `View as` role switcher is only a design-review aid. Production authorization must use the authenticated user's role and tenant.
- Platform `Admin` users must not impersonate tenant users in the MVP.
- `Finance Admin` has full oversight of cases, GL mapping, user management, audit trail, line-item approval and rejection, AP coding and reconciliation, flags, payment stubs, and deductibility.
- `Department Manager` has scoped case queue access, review access to case detail and line-item approval and rejection, edit access for AP coding and reconciliation, flag clearing, payment stubs, and deductibility, view access to GL mapping and audit trail, and no user management access.
- `Employee` can submit expenses and contractor-style invoices, upload receipts, log mileage, view their own case status, dispute, and comment.

## Workflow and MVP Rules

- Stage transitions must be role-gated and sequence-enforced.
- Denied transition attempts must be recorded in the audit trail.
- Second-pair review must be modeled as normal role-gated `REVIEW` permission, not as a separate subsystem.
- The MVP flag rule is hard-coded, such as any line item over `$500`; do not build an anomaly engine.
- Deductibility is a manual checkbox in `AP Review`, not an automated classifier.
- Payment is a stub in the MVP.
- Due dates only drive an `Overdue` badge in the queue.
- Do not build SLA timers, escalation routing, background jobs, or a separate overdue queue in the MVP.
- Authentication is email and password with MFA for all internal and external users.

## Forbidden Scope

- ExpenseFlow does not build payroll, tax filing, procurement, inventory, travel booking, banking, card issuing, or general ledger systems.
- ExpenseFlow does not build SSO, SAML, OIDC, magic-link authentication, tenant impersonation, anomaly detection, automated deductibility classification, SLA or escalation automation, or production authorization based on role-switch UI in the MVP.
