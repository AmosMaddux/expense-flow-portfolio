# AWS Runtime Smoke Scripts

These scripts create and verify the temporary SCRUM-147 ECS Fargate sandbox runtime for the Core Case Service and GL-coding service.

They are intentionally Bash scripts for the current ticket. These scripts are temporary and are expected to be replaced by Terraform on August 10, 2026.

## Prerequisites

Run these commands from the repository root.

Required local tools:

- AWS CLI authenticated with profile `expenseflow-smoke`
- Docker with Buildx support
- Node.js, used by the task-definition render script
- OpenSSL, used to generate synthetic JWT key material for sandbox secrets

Default AWS target:

- Profile: `expenseflow-smoke`
- Region: `us-east-1`
- VPC: `vpc-07d74aa9f23a0a4d5`
- Public subnets: `subnet-009a1b8ff487f5f03`, `subnet-0c860e6ff8d54bd74`

Verify identity first:

```bash
aws sts get-caller-identity --profile expenseflow-smoke --region us-east-1
```

Required runtime values:

- `CORE_CASE_DATABASE_URL`: ECS-reachable PostgreSQL URL for Core Case.
- `GL_CODING_DATABASE_URL`: ECS-reachable PostgreSQL URL for GL-coding.
- `GL_CODING_SERVICE_BASE_URL`: ECS-reachable Core Case to GL-coding HTTP base URL.
- `REDIS_URL`: ECS-reachable Redis URL for Core Case.

The scripts reject `localhost` and `127.0.0.1` for these values because each Fargate task has its own network namespace.

## Script Order

### DynamoDB Only

Create or tag the AWS DynamoDB table that matches the local Expense Report read-projection defaults:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/create-expense-report-dynamodb-table.sh
```

The script creates `expenseflow-expense-reports` with primary key `id` and GSI `tenantId-index` unless `DYNAMODB_EXPENSE_REPORT_TABLE` or `DYNAMODB_EXPENSE_REPORT_TENANT_INDEX` are overridden.

### 1. Create Runtime Smoke Resources

```bash
CORE_CASE_DATABASE_URL="$CORE_CASE_DATABASE_URL" \
GL_CODING_DATABASE_URL="$GL_CODING_DATABASE_URL" \
GL_CODING_SERVICE_BASE_URL="$GL_CODING_SERVICE_BASE_URL" \
REDIS_URL="$REDIS_URL" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/create-runtime-smoke-resources.sh
```

This creates or updates the AWS resources that the task definitions need:

- ECR repositories
- ECS cluster
- CloudWatch log groups
- SNS topic for stage-transition events
- S3 bucket for synthetic receipt-storage smoke paths
- DynamoDB table for the configured Expense Report read-projection path, using the local defaults `expenseflow-expense-reports` and `tenantId-index` unless overridden
- Fargate task security groups
- IAM execution and task roles
- Core Case task-role permissions for SNS, S3, and DynamoDB runtime calls
- Secrets Manager values

Database URLs are stored in Secrets Manager from the operator-supplied values. The script does not create PostgreSQL, Redis, service discovery, an internal load balancer, or ECS services.

The script is idempotent where AWS supports it, so it can be rerun after a partial failure.

### 2. Build And Push Images

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/build-push-images.sh
```

This builds both service images for `linux/amd64`, tags them as `scrum-147-smoke`, and pushes them to ECR:

- `expenseflow-core-case-service`
- `expenseflow-gl-coding-service`

Run this after creating ECR repositories and before registering task definitions.

### 3. Register Task Definitions

```bash
CORE_CASE_DATABASE_URL="$CORE_CASE_DATABASE_URL" \
GL_CODING_DATABASE_URL="$GL_CODING_DATABASE_URL" \
GL_CODING_SERVICE_BASE_URL="$GL_CODING_SERVICE_BASE_URL" \
REDIS_URL="$REDIS_URL" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/register-task-definitions.sh
```

This renders the portable task-definition templates with real AWS values, then registers:

- `expenseflow-core-case-service`
- `expenseflow-gl-coding-service`

`GL_CODING_SERVICE_BASE_URL` and `REDIS_URL` must be ECS-reachable endpoints such as Cloud Map, ECS Service Connect, or internal load balancer DNS names. The registration script rejects `localhost` and `127.0.0.1` for those cross-task dependencies because each Fargate task has its own network namespace.

Rendered task-definition JSON is written to `/tmp/expenseflow-scrum-147-task-definitions` by default because it contains account-specific ARNs and ECR image URIs.

Validate template rendering locally without registering task definitions:

```bash
CORE_CASE_DATABASE_URL="postgres://expenseflow_sandbox:synthetic-password@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_DATABASE_URL="postgres://expenseflow_sandbox:synthetic-password@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_SERVICE_BASE_URL="http://gl-coding.expenseflow-sandbox.local:8001" \
REDIS_URL="redis://redis.expenseflow-sandbox.local:6379" \
VALIDATE_RENDER_ONLY=true \
scripts/aws/register-task-definitions.sh
```

### 4. Run The Fargate Smoke

```bash
STOP_AFTER_SMOKE=true AWS_PROFILE=expenseflow-smoke scripts/aws/run-task-smoke.sh
```

This runs one-off Fargate tasks for both services in the existing public subnets with public IP assignment enabled.

Expected result:

- Preflight confirms the registered Core Case task definition does not contain loopback GL-coding or Redis endpoints.
- Preflight confirms the configured SNS topic, S3 bucket, DynamoDB table, task roles, and Core Case runtime task-role policy are present.
- GL-coding reaches `RUNNING` and container health becomes `HEALTHY`.
- Core Case reaches `RUNNING` and container health becomes `HEALTHY`.
- CloudWatch log stream names are printed.
- With `STOP_AFTER_SMOKE=true`, both tasks are stopped after passing.

This proves ECS can pull the ECR images, inject Secrets Manager values, start the containers on Fargate, run container health checks, write logs, and reference the expected AWS runtime resources. It does not prove a full Expense Report submission path, database connectivity, or Core Case to GL-coding request success; that deeper smoke requires the later service-discovery and database infrastructure work.

## Useful Verification Commands

Check active task definitions:

```bash
aws ecs describe-task-definition \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --task-definition expenseflow-core-case-service:1 \
  --query 'taskDefinition.{status:status,cpu:cpu,memory:memory,executionRole:executionRoleArn,taskRole:taskRoleArn}'

aws ecs describe-task-definition \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --task-definition expenseflow-gl-coding-service:1 \
  --query 'taskDefinition.{status:status,cpu:cpu,memory:memory,executionRole:executionRoleArn,taskRole:taskRoleArn}'
```

Check that no smoke tasks are still running:

```bash
aws ecs list-tasks \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --cluster expenseflow-sandbox \
  --desired-status RUNNING
```

Tail logs:

```bash
aws logs tail /ecs/expenseflow-sandbox/core-case-service \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --since 30m

aws logs tail /ecs/expenseflow-sandbox/gl-coding-service \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --since 30m
```

## Teardown

Only run teardown when the sandbox smoke resources are no longer needed:

```bash
CONFIRM_RESOURCE_TEARDOWN=SCRUM-147 AWS_PROFILE=expenseflow-smoke scripts/aws/tear-down-runtime-smoke-resources.sh
```

The teardown script stops pending or running smoke tasks, deregisters and deletes task-definition revisions where AWS permits it, deletes the ECS cluster, deletes ECR repositories and pushed images, force-deletes the synthetic Secrets Manager entries, deletes CloudWatch log groups, deletes task security groups, removes IAM role policies and roles, and deletes rendered task-definition output under `/tmp`.
