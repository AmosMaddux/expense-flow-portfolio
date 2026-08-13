# SCRUM-146 AWS Walkthrough Credentials

Prefer a named AWS profile for the production-resource walkthrough. This keeps
short-lived credentials out of `.env` while still letting the AWS SDK refresh
credentials through the local AWS config.

```bash
aws login --profile expenseflow-smoke
aws sts get-caller-identity --profile expenseflow-smoke
```

Use the returned `Account` value as `EXPECTED_AWS_ACCOUNT_ID` in `.env`:

```bash
AWS_PROFILE=expenseflow-smoke
AWS_REGION=us-east-1
EXPECTED_AWS_ACCOUNT_ID=REPLACE_WITH_AWS_ACCOUNT_ID
```

Run the walkthrough with the profile available to the test process and the
local Compose service:

```bash
AWS_PROFILE=expenseflow-smoke AWS_REGION=us-east-1 EXPENSE_FLOW_RUN_PRODUCTION_TESTS=1 npx vitest run backend/core-case-service/tests/production/localComposeAwsWalkthrough.test.ts --project production
```

For IAM Identity Center environments, refresh the same profile first:

```bash
aws sso login --profile expenseflow-smoke
aws sts get-caller-identity --profile expenseflow-smoke
```

Exported temporary credentials are still supported when a profile is not
available:

```bash
aws configure export-credentials --profile expenseflow-smoke --format env
```

If both `AWS_PROFILE` and exported credential variables are present, the
walkthrough uses the profile by default. Set
`AWS_WALKTHROUGH_USE_EXPORTED_CREDENTIALS=true` only when the exported session
variables should override the profile.

## Cleanup

The production walkthrough test deletes the DynamoDB projection item that it
inserts before the test exits. Matching SQS messages are deleted only after the
test consumes the synthetic correlation IDs created for that run.

The resource script is intentionally create-or-verify by default:

```bash
scripts/aws/SCRUM-146/create-production-walkthrough-resources.sh
```

To remove resources that were created specifically for this walkthrough, use
the guarded teardown mode:

```bash
ACTION=teardown CONFIRM_TEARDOWN=SCRUM-146 scripts/aws/SCRUM-146/create-production-walkthrough-resources.sh
```

Set `DYNAMODB_EXPENSE_REPORT_TABLE`, `STAGE_TRANSITION_SNS_TOPIC_NAME`,
`STAGE_TRANSITION_SQS_QUEUE_NAME`, and `STAGE_TRANSITION_SQS_DLQ_NAME` when
tearing down non-default walkthrough resource names.
