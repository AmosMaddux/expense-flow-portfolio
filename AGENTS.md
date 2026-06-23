# ExpenseFlow Agent Contract

These rules apply to all work in this repository.

## Data Handling

- Follow the repository data classification posture in [docs/data-classification.md](docs/data-classification.md).
- Never place controlled data, production data, customer data, credentials, tokens, API keys, secrets, or private identifiers in prompts, generated code, logs, tests, fixtures, documentation, or output.
- When realistic data is needed, substitute a synthetic fixture that cannot identify a real person, organization, account, transaction, vendor, card, or system secret.
- If a request includes controlled data or secrets, refuse to repeat or transform those values and replace them with a clearly synthetic example.

## Language Standards

- The only allowed application stacks are TypeScript with Express and Python with FastAPI.
- Any technology outside those stacks is forbidden for this project unless this agent contract is changed.
- Refuse to generate Java, Spring, JPA, or MongoDB code, configuration, schemas, migrations, examples, or scaffolds for this project.
- If asked for a forbidden stack, state that ExpenseFlow does not use that technology and provide an equivalent TypeScript/Express or Python/FastAPI implementation instead.

## ExpenseFlow Domain Vocabulary

- The primary case is `Expense Report`.
- Expense Report stages are `Draft`, `Submitted`, `Manager Review`, `Finance Review`, `Approved`, and `Reimbursed`.
- The supported roles are `Finance Admin`, `Department Manager`, and `Employee`.
- Generated code, tests, routes, models, and documentation should use these exact domain terms unless an existing file defines a narrower local convention.

## Forbidden Scope

- ExpenseFlow does not build payroll, tax filing, procurement, inventory, travel booking, banking, card issuing, or general ledger systems.
