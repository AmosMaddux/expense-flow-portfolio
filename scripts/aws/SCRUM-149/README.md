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
- Verification timeout: `180` seconds

The deploy script requires `DATABASE_URL` to be resolved before it starts, normally by running the script under `asm-exec`. The Lambda handler validates that `DATABASE_URL` is already resolved before DB-backed modules load; it does not call Secrets Manager or accept `DATABASE_URL_SECRET_ID`.

`VPC_ID` and `PRIVATE_SUBNETS` must be supplied explicitly. Use subnets that can reach the Core Case database. The database security group must allow inbound PostgreSQL from the SCRUM-149 Lambda security group.

`verify-stage-transition-lambda.sh` always checks Lambda/SQS wiring, Lambda
database environment safety, and IAM policy shape. Set
`VERIFY_CONSUMER_BEHAVIOR=true` to publish a synthetic valid event, poll Lambda
invocation metrics, assert one row appears in `stage_transition_projection`,
republish the same event to prove idempotent duplicate handling, publish a
malformed SQS message, and poll until the failed message reaches the DLQ. The
behavior verification requires `VERIFY_DATABASE_URL` or `DATABASE_URL` to be
resolved before the script starts, normally by running it under `asm-exec`.

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
DATABASE_URL="$DATABASE_URL" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/deploy-stage-transition-lambda.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-149/wire-stage-transition-event-source.sh

VERIFY_CONSUMER_BEHAVIOR=true \
VERIFY_DATABASE_URL="$DATABASE_URL" \
SYNTHETIC_EXPENSE_REPORT_ID="$SYNTHETIC_EXPENSE_REPORT_ID" \
SYNTHETIC_TENANT_ID="$SYNTHETIC_TENANT_ID" \
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
