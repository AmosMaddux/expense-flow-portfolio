# SCRUM-150 Issue Payment Lambda Scripts

These temporary Bash scripts package, deploy, verify, smoke test, and tear down
the Issue Payment stub Lambda behind the shared HTTP API JWT authorizer.

The Lambda forwards a trusted internal command to Core Case. It does not receive
database secrets, call Secrets Manager for `DATABASE_URL`, or write PostgreSQL.

## Defaults

- AWS profile: `expenseflow-smoke`
- AWS region: `us-east-1`
- SAM stack: `expenseflow-issue-payment-http-api-sandbox`
- Lambda function: `expenseflow-issue-payment-stub`
- Route: `POST /expense-reports/{id}/settlement`
- Core Case internal command header: `x-core-case-internal-command-token`
- Tags: `user=muhilramesh`, `env=sandbox`, `ticket=SCRUM-150`

## Required Inputs

- `ROLE_PERMISSIONS_BOUNDARY_ARN`
- `HTTP_API_ID` or `HTTP_API_STACK_NAME`
- `CORE_CASE_INTERNAL_BASE_URL`
- `CORE_CASE_INTERNAL_COMMAND_TOKEN`

`SHARED_JWT_AUTHORIZER_ID` can be supplied explicitly. When omitted, scripts
discover the first JWT authorizer attached to `HTTP_API_ID`.

If the Lambda must run in the VPC to reach Core Case, supply:

- `VPC_ID`
- `PRIVATE_SUBNETS`

`LAMBDA_SECURITY_GROUP_ID` can be supplied explicitly. When omitted with
`VPC_ID`, the create script creates and tags
`expenseflow-issue-payment-lambda-sg`.

## Script Order

Run from the repository root:

```bash
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/package-issue-payment-lambda.sh

ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
HTTP_API_ID="$HTTP_API_ID" \
VPC_ID="${VPC_ID:-}" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/create-issue-payment-lambda-resources.sh

ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
HTTP_API_ID="$HTTP_API_ID" \
CORE_CASE_INTERNAL_BASE_URL="$CORE_CASE_INTERNAL_BASE_URL" \
CORE_CASE_INTERNAL_COMMAND_TOKEN="$CORE_CASE_INTERNAL_COMMAND_TOKEN" \
PRIVATE_SUBNETS="${PRIVATE_SUBNETS:-}" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/deploy-issue-payment-lambda.sh

HTTP_API_ID="$HTTP_API_ID" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/verify-issue-payment-lambda.sh

ISSUE_PAYMENT_URL="https://api-id.execute-api.us-east-1.amazonaws.com/v1/expense-reports/$EXPENSE_REPORT_ID/settlement" \
VALID_ACCESS_TOKEN="$VALID_ACCESS_TOKEN" \
EXPIRED_ACCESS_TOKEN="$EXPIRED_ACCESS_TOKEN" \
EXPENSE_REPORT_ID="$EXPENSE_REPORT_ID" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/smoke-issue-payment-http-api.sh
```

## Teardown

The teardown deletes only SCRUM-150-owned stack resources. It does not delete the
shared HTTP API stack, SCRUM-149 stage-transition Lambda resources, ECS/ALB
runtime resources, or any database resources.

```bash
CONFIRM_RESOURCE_TEARDOWN=SCRUM-150 \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-150/tear-down-issue-payment-lambda-resources.sh
```
