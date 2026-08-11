# SCRUM-149 Stage-Transition Lambda Scripts

These temporary Bash scripts move the stage-transition event consumer into an SQS-triggered Lambda while reusing Donovan's existing sandbox event resources.

## Defaults

- AWS profile: `expenseflow-smoke`
- AWS region: `us-east-1`
- Lambda function: `expenseflow-stage-transition-consumer`
- Lambda image repository: `expenseflow-stage-transition-consumer-lambda`
- Lambda image tag: `scrum-149-smoke`
- SQS queue: `expenseflow-report-stage-transitioned-events`
- SQS DLQ: `expenseflow-report-stage-transitioned-dlq`
- SNS topic: `expenseflow-report-stage-transitioned-v1`
- Database secret: `expenseflow/sandbox/core-case/database-url`
- VPC: `vpc-07d74aa9f23a0a4d5`
- Private subnets: `subnet-0aefa6933acb130d5,subnet-0f35fcc094f77ec8b`

The Lambda environment stores `DATABASE_URL_SECRET_ID`, not the raw database URL. The handler fetches and caches the secret value from Secrets Manager at runtime.

## Script Order

Run from the repository root:

```bash
ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/create-stage-transition-lambda-resources.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/package-stage-transition-lambda.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/deploy-stage-transition-lambda.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/wire-stage-transition-event-source.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/verify-stage-transition-lambda.sh
```

## Teardown

The teardown deletes only SCRUM-149-owned Lambda resources. It does not delete Donovan's VPC, SNS topic, SQS queue, DLQ, or DynamoDB table.

```bash
CONFIRM_RESOURCE_TEARDOWN=SCRUM-149 \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/tear-down-stage-transition-lambda-resources.sh
```
