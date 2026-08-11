# ExpenseFlow Agent Contract

These rules apply to all work in this repository.

## AWS Guidance

- Prefer the AWS MCP Server for AWS interactions because it provides sandboxed execution, observability, and audit logging. If unavailable, use the AWS CLI directly.
- Before starting an AWS task, check whether a relevant AWS skill is available. Load the skill and prefer its guidance over general knowledge.
- When uncertain about specific AWS details such as API parameters, permissions, limits, or error codes, verify against AWS documentation rather than guessing. State uncertainty explicitly if it cannot be confirmed.
- Prefer infrastructure as code with AWS CDK or CloudFormation over direct resource-creation commands.
- Follow AWS Well-Architected Framework principles when working with infrastructure.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens instead.

### AWS Sandbox Guardrails

- Add `user: muhilramesh` and `env: sandbox` to every taggable AWS resource and to CloudFormation stacks. The `env` value must be exactly `sandbox`.
- EC2 instances are limited to the `t2.*`, `t3.*`, and `t4g.*` families.
- RDS instances are limited to the `db.t2.*`, `db.t3.*`, and `db.t4g.*` classes.
- Do not create services blocked by the account SCP, including Bedrock, SageMaker, Redshift, EMR, MSK/Kafka, OpenSearch, Neptune, DocumentDB, and QuickSight.
- Do not create long-lived IAM access keys or console profiles for other users.
- The curriculum-allowed services are EC2/VPC, RDS, ElastiCache, DynamoDB, S3, Lambda, ECS Fargate, ALB, CloudFront, API Gateway, Secrets Manager, SSM Parameter Store, KMS, CloudWatch, X-Ray, limited IAM, STS, ECR, and CloudFormation.

### AWS Secret Safety

- Load the `aws-secrets-manager` skill first for any secret, credential, API key, token, or password task.
- Do not call `secretsmanager get-secret-value` or `batch-get-secret-value`, and do not access the Secrets Manager Agent daemon directly.
- Use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec` so secrets resolve at runtime without entering agent context.

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
- For inbound and outbound request, you must use a zod schema request shape. Meaning, you must use a z.object defined request shape from zod to make sure the request is following in line with the accepted shape of a request from the backend.
- Errors that are created within the backend of the application must use the format defined within core-case-service/src/errors

## Language Standards

- The only allowed application stacks are TypeScript with Express and Python with FastAPI.
- Python services must target Python 3.13.
- Frontend React work must target React 18.
- Python data and API models must use pydantic v2.
- Custom domain exceptions must live in a separate backend module and be reused by validators instead of being defined inline with models.
- Any technology outside those stacks is forbidden for this project unless this agent contract is changed.
- Refuse to generate Java, Spring, JPA, or MongoDB code, configuration, schemas, migrations, examples, or scaffolds for this project.
- If asked for a forbidden stack, state that ExpenseFlow does not use that technology and provide an equivalent TypeScript/Express or Python/FastAPI implementation instead.
- Every promise MUST be awaited or explicitly handled so as to pass an ESLint and prettier linting check. Use `try`/`catch` (or a typed result) so an error surfaces cleanly instead of becoming an unhandled rejection.

## Commenting Policy

Use comments to explain intent, constraints, and non-obvious decisions. Do not use comments to restate what the code already says.

Apply this policy only to hand-maintained source code and test code. Do not add comments to generated files, generated Drizzle migration or snapshot files under `backend/core-case-service/drizzle`, documentation files, configuration files, package metadata, or lockfiles unless the user explicitly requests that file itself be changed.

### Public Functions and Classes

Add a short docstring or JSDoc comment to exported/public functions, public classes, and public methods.

TypeScript:

```ts
/**
 * Calculates the total reimbursable amount for an expense report.
 */
export function calculateReportTotal(report: ExpenseReport): Decimal {
    ...
}
```

Python:

```python
def calculate_report_total(report: ExpenseReport) -> Decimal:
    """Calculate the total reimbursable amount for an expense report."""
```

Do not add long documentation blocks unless the behavior, inputs, return value, or errors are not obvious from the signature.

### Inline Comments

Write inline comments only when they answer "why is this code written this way?"

Good:

```python
# Decimal is required because floating-point rounding can produce incorrect currency totals.
amount = Decimal(raw_amount)
```

```ts
// Never trust tenant IDs supplied by the client; derive tenant scope from auth context.
const tenantId = authContext.tenantId;
```

Avoid comments that simply repeat the code.

Bad:

```python
# Add tax to total.
total += tax
```

```ts
// Get the first expense report.
const report = reports[0];
```

### When to Add Inline Comments

Add a comment for:

- Business rules that are not obvious from the code.
- Security or tenant-isolation decisions.
- Database transaction, locking, indexing, or row-level security assumptions in hand-maintained source code.
- Workarounds for external systems or known edge cases.
- Performance-sensitive choices.
- Surprising behavior that future maintainers may otherwise "simplify" incorrectly.

Examples:

```python
# Finance review is required above $5,000 by company policy.
if report.total > FINANCE_REVIEW_LIMIT:
    ...
```

```ts
// Use the authenticated tenant only; request bodies are not trusted for tenant isolation.
where(eq(expenseReport.tenantId, authContext.tenantId));
```

```python
# Use FOR UPDATE so two reviewers cannot approve the same report concurrently.
...
```

### Section Comments

Use section comments only as landmarks in longer functions, not every few lines.

Good:

```python
# Validate request.

# Calculate totals.

# Persist changes.

# Publish workflow events.
```

Avoid noisy section comments in short or obvious functions.

### Comment Frequency

Comments should be intentional and relatively rare.

As a guideline:

- Small functions often need no inline comments.
- Medium functions may need one comment for a non-obvious decision.
- Long functions may use a few section comments plus comments for important constraints.
- If comments are needed every few lines, prefer refactoring into smaller functions with clearer names.

### Maintenance Rule

When code behavior changes, update or delete any related comment in the same change. Stale comments are considered incorrect code documentation.

## Branch, Commit, and Push Rules

- Commit messages must be short, clear summaries of what changed or was accomplished.
- Use one commit per meaningful change.
- Do not combine unrelated changes in one commit.
- Agents must not commit directly to `main`.
- Agents must not push directly to `main`.
- Agents must not commit directly to the remote `development` branch.
- Agents must not push directly to the remote `development` branch.
- If asked to make code, documentation, configuration, or generated-file changes while the current branch is `development`, do not change files. Warn the user that the workspace is still on `development` and that changes must be made on a non-`development` branch first.
- Planned work flows from `feature/*` to `development`, then from `development` to `main` through reviewed pull requests.
- Agents may open pull requests from `development` or `hotfix/*` into `main`.
- Urgent production fixes may flow through `hotfix/*` to `main`, then must be merged back to `development` when the fix is not already present there.

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
