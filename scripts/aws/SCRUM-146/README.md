# SCRUM-146 AWS Session Credentials

Refresh the local AWS session before running the production-resource walkthrough.

```bash
aws login
aws configure export-credentials --profile expenseflow-smoke --format env
```

To append the exported session variables to the repository `.env` file:

```bash
aws configure export-credentials --profile expenseflow-smoke --format env >> .env
```

The walkthrough reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` from `.env`.
