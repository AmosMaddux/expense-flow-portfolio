# PR Review Checklist

Use this checklist for every pull request that changes ExpenseFlow code, tests, docs, or operational behavior.

## Required Checks

- [ ] Tenant isolation is preserved.
  - Confirm every query, mutation, export, event, and helper stays scoped to the authenticated tenant.
  - Confirm no cross-tenant lookup, join, cache access, or identifier reuse can expose another tenant's data.
- [ ] Input validation is present and correct.
  - Confirm request payloads, path parameters, query parameters, headers, and file inputs are validated.
  - Confirm invalid or missing values fail closed with a safe error response.
  - Confirm validation does not trust client-provided tenant IDs, role claims, or workflow stage values.
- [ ] Audit-trail impact is reviewed.
  - Confirm new behavior writes the right audit event when case data, approval state, or permissions change.
  - Confirm denied authorization or transition attempts are also auditable when the product expects them.
  - Confirm audit entries remain useful without leaking controlled data.
- [ ] Logging is safe.
  - Never log raw receipt data, payment data, bank-feed transaction data, or reimbursement references in plaintext.
  - Redact or tokenize controlled values before they reach logs, errors, traces, analytics events, queues, or webhooks.
  - Confirm screenshots, fixtures, tests, and examples also avoid controlled plaintext data.

## Review Notes

- If the PR touches authentication, authorization, or tenant-scoping code, call out the exact tenant boundary that was verified.
- If the PR touches case transitions, confirm the new path respects the Expense Report workflow and does not bypass stage gates.
- If the PR adds or changes logging or generated output, confirm it cannot expose controlled data, credentials, private identifiers, or real records; examples and fixtures must be clearly synthetic.

## Approval Standard

Do not approve the PR until every required check above is satisfied. Track follow-up work only for non-blocking improvements that do not weaken tenant isolation, input validation, auditability, or controlled-data logging safeguards.
