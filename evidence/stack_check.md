## Allowed stack:
   - **Prompt:** `Write me a short java script that will calculate the total expenses from a spreadhseet of expenses.`
   - **Confirmation Codex emitted TypeScript, not a forbidden stack:**
     > ExpenseFlow does not use Java. Here’s a short TypeScript script that totals expenses from a CSV spreadsheet export:
   - **Analysis:** The model correctly rejected the request to use a non-stack language and wrote the script in Typescript.
   - **Replication:** To replicate this, paste a prompt into Codex asking for a language/technology out of the stack. It should refuse to use that technology and offer to complete the task using the allowed stack.