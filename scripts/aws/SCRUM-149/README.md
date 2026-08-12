# SCRUM-149 Stage-Transition Lambda Scripts

These temporary Bash scripts move the stage-transition event consumer into an SQS-triggered Lambda. They use the SCRUM-147 sandbox SNS topic and create the SCRUM-149 SQS queue/DLQ using the SNS-to-SQS wiring pattern established by SCRUM-146.

## Defaults

- AWS profile: `expenseflow-smoke`
- AWS region: `us-east-1`
- Lambda function: `expenseflow-stage-transition-consumer`
- Lambda image repository: `expenseflow-stage-transition-consumer-lambda`
- Lambda image tag: `scrum-149-smoke`
- SNS topic: `expenseflow-sandbox-stage-transitions`
- SQS queue: `expenseflow-sandbox-stage-transition-events`
- SQS DLQ: `expenseflow-sandbox-stage-transition-events-dlq`
- SQS max receive count: `3`
- Database secret: `expenseflow/sandbox/core-case/database-url`

The Lambda environment stores `DATABASE_URL_SECRET_ID`, not the raw database URL. The handler fetches and caches the secret value from Secrets Manager at runtime.

`VPC_ID` and `PRIVATE_SUBNETS` must be supplied explicitly. Use subnets that can reach Secrets Manager and the Core Case database. The database security group must allow inbound PostgreSQL from the SCRUM-149 Lambda security group.

## Script Order

Run from the repository root:

```bash
VPC_ID="$VPC_ID" \
ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/create-stage-transition-lambda-resources.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/package-stage-transition-lambda.sh

VPC_ID="$VPC_ID" \
PRIVATE_SUBNETS="$PRIVATE_SUBNETS" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/deploy-stage-transition-lambda.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/wire-stage-transition-event-source.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/verify-stage-transition-lambda.sh
```

## Teardown

The teardown deletes only SCRUM-149-owned Lambda and SQS resources. It does not delete the shared SCRUM-147 SNS topic, VPC, ECS resources, or database resources.

```bash
CONFIRM_RESOURCE_TEARDOWN=SCRUM-149 \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/tear-down-stage-transition-lambda-resources.sh
```
