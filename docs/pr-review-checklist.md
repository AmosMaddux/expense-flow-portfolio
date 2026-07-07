# AI-Augmented PR Review Checklist

Use this checklist for every pull request that changes ExpenseFlow code, tests, docs, or operational behavior. This file is the required AI code-review prompt and human reviewer checklist referenced by the pull request template.

AI-assisted review can accelerate review, but it does not replace human approval. The reviewer is accountable for confirming the output is correct, complete, and consistent with ExpenseFlow's product and data-handling rules.

## AI Review Prompt

Paste this prompt into the AI review tool, then add the PR diff or direct the tool to the branch under review:

```text
You are reviewing an ExpenseFlow Corporate pull request for the Core Case Service.

Review for correctness, security, maintainability, and consistency with the repository contract.

Required context:
- ExpenseFlow is a multi-tenant expense and reimbursement workflow product.
- The primary case is an Expense Report.
- Expense Report stages are Drafted, Submitted, Manager Approval, AP Review, Paid, and Reconciled.
- There is no separate status field; case condition lives in current_stage.
- Rejections at Manager Approval or AP Review transition backward to Drafted.
- Role and tenant must drive UI visibility and API authorization.
- Denied transition attempts must be recorded in the audit trail.
- The MVP uses a hard-coded flag rule and manual deductibility, not anomaly detection or automated classification.
- Use only synthetic data in code, tests, fixtures, logs, and docs.

Check the diff for:
1. Tenant isolation failures or cross-tenant data exposure.
2. Missing or unsafe authorization checks for Finance Admin, Department Manager, Employee, or Admin.
3. Expense Report workflow violations, skipped stage gates, or incorrect use of current_stage.
4. Missing audit events for case changes, permission changes, or denied transition attempts.
5. Unsafe input validation, including trust in client-provided tenant IDs, role claims, or workflow stage values.
6. Plaintext logging or generated output containing controlled data, payment data, receipt data, credentials, tokens, API keys, secrets, or private identifiers.
7. Use of forbidden stacks or forbidden MVP scope.
8. Missing or weak tests for changed behavior.
9. Comments that restate code instead of explaining intent, constraints, security or tenant-isolation decisions, database assumptions, workarounds, or non-obvious behavior.
10. Architectural changes that need a linked ADR.

Return findings first, ordered by severity. Include file and line references when possible. If there are no blocking findings, say so and list any residual risks or test gaps.
```

## Required Checks

- [ ] Branch and PR conventions are followed.
    - Confirm the branch is short-lived and uses the exact naming convention from `CONTRIBUTING.md`.
    - Confirm `feature/*` branches target `develop`, `release/*` branches target `develop` and `main`, and `hotfix/*` branches target `main` and `develop`.
    - Confirm the PR template is complete and links the Jira ticket.
    - Confirm the PR generally maps to one Jira ticket, or references all related Jira tickets when several tickets describe the same issue or body of work.
    - Confirm required local tests passed before push for `feature/*` branches.
    - Confirm an ADR is linked when the PR changes architecture, tenant boundaries, workflow contracts, authorization models, data classification posture, or technology choices.
- [ ] Tenant isolation is preserved.
    - Confirm every query, mutation, export, event, and helper stays scoped to the authenticated tenant.
    - Confirm no cross-tenant lookup, join, cache access, or identifier reuse can expose another tenant's data.
- [ ] Authorization is role- and tenant-driven.
    - Confirm production behavior does not rely on the design-review `View as` role switcher.
    - Confirm `Finance Admin`, `Department Manager`, `Employee`, and `Admin` access rules match the repository contract.
- [ ] Input validation is present and correct.
    - Confirm request payloads, path parameters, query parameters, headers, and file inputs are validated.
    - Confirm invalid or missing values fail closed with a safe error response.
    - Confirm validation does not trust client-provided tenant IDs, role claims, or workflow stage values.
- [ ] Expense Report workflow rules are preserved.
    - Confirm the only stages are `Drafted`, `Submitted`, `Manager Approval`, `AP Review`, `Paid`, and `Reconciled`.
    - Confirm `current_stage` remains the source of truth and no separate status field is introduced.
    - Confirm rejection at `Manager Approval` or `AP Review` transitions backward to `Drafted`.
    - Confirm `Reconciled` remains terminal.
- [ ] Audit-trail impact is reviewed.
    - Confirm new behavior writes the right audit event when case data, approval state, or permissions change.
    - Confirm denied authorization or transition attempts are also auditable when the product expects them.
    - Confirm audit entries remain useful without leaking controlled data.
- [ ] Logging is safe.
    - Never log raw receipt data, payment data, bank-feed transaction data, or reimbursement references in plaintext.
    - Redact or tokenize controlled values before they reach logs, errors, traces, analytics events, queues, or webhooks.
    - Confirm screenshots, fixtures, tests, and examples also avoid controlled plaintext data.
- [ ] Comments follow the repository policy in `AGENTS.md`.
  - Confirm exported/public functions, public classes, and public methods have short docstrings or JSDoc comments where required.
  - Confirm inline comments explain non-obvious intent, constraints, tenant-isolation decisions, database assumptions, workarounds, performance choices, or surprising behavior.
  - Confirm stale or redundant comments were updated or removed.
- [ ] All migrations have a matching rollback created

## Review Notes

- If the PR touches authentication, authorization, or tenant-scoping code, call out the exact tenant boundary that was verified.
- If the PR touches case transitions, confirm the new path respects the Expense Report workflow and does not bypass stage gates.
- If the PR adds or changes logging or generated output, confirm it cannot expose controlled data, credentials, private identifiers, or real records; examples and fixtures must be clearly synthetic.
- If the PR changes architecture, tenant boundaries, workflow contracts, authorization models, data classification posture, or technology choices, confirm the linked ADR exists and matches the implementation.
- If AI review produced findings, confirm each finding is fixed, documented as non-blocking, or explicitly rejected with reviewer rationale.

## Approval Standard

Do not approve the PR until every required check above is satisfied. Track follow-up work only for non-blocking improvements that do not weaken tenant isolation, input validation, auditability, or controlled-data logging safeguards.
