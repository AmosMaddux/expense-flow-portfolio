# ExpenseFlow Data Classification

ExpenseFlow uses three data buckets for prompts, generated code, tests, logs, documentation, fixtures, and operational output.

## PUBLIC

PUBLIC data is approved for public disclosure. Examples include published product documentation, public policy text, public repository metadata, and synthetic examples that cannot identify a real person, organization, account, vendor, transaction, card, bank feed, or secret.

Synthetic or PUBLIC data may enter a prompt.

## CUI

CUI is controlled unclassified information that requires safeguarding. For ExpenseFlow, CUI includes real customer, employee, tenant, vendor, payment, reimbursement, attachment, receipt, approval, audit, and bank-feed transaction data.

Real CUI must not enter prompts, generated examples, logs, tests, fixtures, documentation, screenshots, issue text, or model output.

## SBU

SBU is sensitive-but-unclassified information that is not approved for public release and could create security, privacy, compliance, financial, or operational risk if exposed. Examples include internal identifiers, private tenant configuration, operational runbooks, incident details, support context, access patterns, non-public architecture details, and secrets.

Real SBU data and secrets must not enter prompts, generated examples, logs, tests, fixtures, documentation, screenshots, issue text, or model output.

## Bright Line

Synthetic or PUBLIC data may enter a prompt. Real CUI/SBU data and secrets never do.

If realistic data is needed, create a clearly synthetic fixture. If a request contains real CUI/SBU data or secrets, do not repeat, transform, summarize, normalize, or encode those values. Replace them with synthetic examples and remind the user that CUI/SBU must never be included in prompts.

## ExpenseFlow Controlled Fields

Payment and bank-feed transaction data is controlled. This includes payment instrument details, bank account details, bank-feed transaction records, merchant or vendor payment metadata, reimbursement payment references, external transaction identifiers, authorization details, and any field that can identify or reconstruct a real payment event.

Plaintext payment data must never appear in logs, errors, traces, analytics events, audit events, queues, webhooks, event payloads, test output, generated fixtures, or prompt content. Use redaction, tokenization, stable synthetic identifiers, or aggregate values that cannot identify a real payment.

## Isolation and Access Expectations

Every tenant's data is isolated, and services run with least privilege.

Later sprints must satisfy per-tenant scoping and least-privilege expectations:

- Per-tenant scoping must apply to records, queries, application code, background jobs, queues, caches, exports, analytics events, and operational tooling so one tenant cannot read, write, infer, search, export, or receive another tenant's data.
- No plaintext payment data may appear in logs, errors, traces, analytics events, audit events, queues, webhooks, test output, generated fixtures, or prompt content.
- Services, jobs, integrations, and operational tooling must run with only the privileges required for their ExpenseFlow responsibilities.
- Access must be granted by least privilege for the supported roles: `Finance Admin`, `Department Manager`, and `Employee`.
- Privileged actions must be auditable without logging controlled payment data or secrets.
- Tests must include tenant-isolation and authorization checks using only synthetic data.
