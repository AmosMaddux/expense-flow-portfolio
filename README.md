# ExpenseFlow

ExpenseFlow is an expense tracking repository governed by the local agent contract and Codex configuration.

## Agent Contract

[AGENTS.md](AGENTS.md) is the repository-level instruction file for Codex and other AI agents working in ExpenseFlow. It defines the rules agents must follow before generating code, tests, examples, documentation, or operational output.

The contract covers:

- Data handling rules for controlled data, production data, secrets, and synthetic fixtures.
- Only allowed application stacks: TypeScript with Express and Python with FastAPI.
- Forbidden technologies outside those stacks, including Java, Spring, JPA, and MongoDB.
- Required ExpenseFlow vocabulary, including `Expense Report`, supported stages, and supported roles.
- Forbidden product scope, including payroll, tax filing, procurement, inventory, travel booking, banking, card issuing, and general ledger systems.

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
   test -f config.toml
   ```

3. Review the agent contract before asking Codex to change files.

   Read [AGENTS.md](AGENTS.md). It defines the allowed stacks, forbidden stacks, data-handling rules, ExpenseFlow vocabulary, and forbidden product scope.

4. Review the local Codex configuration.

   Read [config.toml](config.toml). It defines the local Codex model reasoning effort, sandbox mode, and approval policy for this repository.

5. Start Codex from the repository root so it can load the local contract and configuration.

   ```sh
   codex
   ```

6. In the Codex session, verify the working directory is this repository and that requests follow the contract.

   ```sh
   pwd
   git status --short
   ```

7. Use only synthetic data in prompts, examples, tests, fixtures, logs, and documentation. Do not paste real customer data, production data, payment data, bank-feed transaction data, credentials, tokens, API keys, or private identifiers into Codex.

## Governance Links

- [Agent contract](AGENTS.md)
- [Codex configuration](config.toml)
