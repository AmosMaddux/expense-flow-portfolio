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
- curl, used by the ALB smoke script

Default AWS target:

- Profile: `expenseflow-smoke`
- Region: `us-east-1`

Verify identity first:

```bash
aws sts get-caller-identity --profile expenseflow-smoke --region us-east-1
```

Required runtime values:

- `CORE_CASE_DATABASE_URL`: ECS-reachable PostgreSQL URL for Core Case.
- `GL_CODING_DATABASE_URL`: ECS-reachable PostgreSQL URL for GL-coding.
- `REDIS_URL`: ECS-reachable Redis URL for Core Case.
- `VPC_ID`: VPC where the ALB, target groups, and task security groups are created.
- `PUBLIC_SUBNETS`: comma-separated public subnet IDs for the ALB and Fargate services.
- `INTERNAL_SUBNETS`: optional comma-separated subnet IDs for the internal GL-coding ALB. Defaults to `PUBLIC_SUBNETS` for the sandbox.
- `ROLE_PERMISSIONS_BOUNDARY_ARN`: permissions boundary ARN required for sandbox IAM roles.

The scripts reject `localhost` and `127.0.0.1` for these values because each Fargate task has its own network namespace.

`GL_CODING_SERVICE_BASE_URL` is required when registering task definitions. Use the internal GL-coding ALB DNS printed by the resource script:

```bash
GL_CODING_SERVICE_BASE_URL="http://<internal-gl-coding-alb-dns>"
```

## Script Order

### 1. Create Runtime Smoke Resources

```bash
CORE_CASE_DATABASE_URL="$CORE_CASE_DATABASE_URL" \
GL_CODING_DATABASE_URL="$GL_CODING_DATABASE_URL" \
REDIS_URL="$REDIS_URL" \
VPC_ID="$VPC_ID" \
PUBLIC_SUBNETS="$PUBLIC_SUBNETS" \
INTERNAL_SUBNETS="${INTERNAL_SUBNETS:-$PUBLIC_SUBNETS}" \
ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/create-runtime-smoke-resources.sh
```

This creates or updates the AWS resources that the task definitions need:

- ECR repositories
- ECS cluster
- CloudWatch log groups
- Internet-facing Application Load Balancer
- HTTP listener with `/v1/*` routing to Core Case
- Internal Application Load Balancer for GL-coding
- Core Case and internal GL-coding target groups
- SNS topic for stage-transition events
- S3 bucket for synthetic receipt-storage smoke paths
- DynamoDB table for the configured Expense Report read-projection path
- ALB and Fargate task security groups
- IAM execution and task roles
- Core Case task-role permissions for SNS, S3, and DynamoDB runtime calls
- Secrets Manager values

Database URLs are stored in Secrets Manager from the operator-supplied values. The script does not create PostgreSQL, Redis, Route 53 records, autoscaling policies, or ECS services.

The script is idempotent where AWS supports it, so it can be rerun after a partial failure.
It prints the internal GL-coding ALB DNS name for the task-registration step.

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

The registration script resolves the stage-transition SNS topic by `STAGE_TRANSITION_SNS_TOPIC_NAME`, which defaults to `expenseflow-sandbox-stage-transitions`, after the resource script creates it.

`GL_CODING_SERVICE_BASE_URL` and `REDIS_URL` must be ECS-reachable endpoints such as Cloud Map, ECS Service Connect, or internal load balancer DNS names. The registration script rejects `localhost` and `127.0.0.1` for those cross-task dependencies because each Fargate task has its own network namespace.

Rendered task-definition JSON is written to `/tmp/expenseflow-scrum-147-task-definitions` by default because it contains account-specific ARNs and ECR image URIs.

Validate template rendering locally without registering task definitions:

```bash
CORE_CASE_DATABASE_URL="postgres://db-user:db-pass@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_DATABASE_URL="postgres://db-user:db-pass@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_SERVICE_BASE_URL="http://internal-gl-coding-alb.expenseflow-sandbox.local" \
REDIS_URL="redis://redis.expenseflow-sandbox.local:6379" \
STAGE_TRANSITION_SNS_TOPIC_ARN="synthetic-stage-transition-topic-ref" \
VALIDATE_RENDER_ONLY=true \
scripts/aws/register-task-definitions.sh
```

### 4. Deploy ECS Services

```bash
VPC_ID="$VPC_ID" \
PUBLIC_SUBNETS="$PUBLIC_SUBNETS" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/deploy-services.sh
```

This creates or updates long-running Fargate services for:

- `expenseflow-core-case-service`
- `expenseflow-gl-coding-service`

Core Case is attached to the public ALB target group, and the public ALB listener routes `/v1/*` to Core Case. GL-coding is attached to an internal ALB target group, so Core Case calls GL-coding through the internal ALB instead of exposing GL-coding on the public ALB.

The services are not autoscaled by these scripts. They use `DESIRED_COUNT`, which defaults to `1`, and ECS replaces unhealthy tasks behind the ALB target groups.

### 5. Run The ALB Smoke

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/run-task-smoke.sh
```

This validates ALB-backed ECS services and calls the ALB DNS name.
If the sandbox AWS Organizations policy still blocks creation of the dedicated
receipt bucket, run the ALB-only smoke with:

```bash
ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE=true \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/run-task-smoke.sh
```

Expected result:

- Preflight confirms ALB, listener rules, target groups, ECS services, task roles, and runtime resources are present.
- Public Core Case and internal GL-coding target groups each report at least one healthy target.
- `http://<alb-dns>/v1/openapi.json` returns HTTP 200 and contains Core Case OpenAPI paths.
- `http://<alb-dns>/v1/runtime-smoke/gl-coding` returns HTTP 200 after Core Case calls GL-coding through its configured base URL.
- A temporary ECS smoke task calls `http://<internal-gl-coding-alb-dns>/health` and receives HTTP 200.

This proves ECS services can run on Fargate behind ALBs, target-group health gates service readiness, the public ALB routes `/v1/*` to Core Case, Core Case is configured to reach GL-coding, and the internal ALB is reachable from the Core Case network path. The Core Case runtime-smoke route is enabled only in this sandbox task definition with `RUNTIME_SMOKE_GL_CODING_ENABLED=true`. When `ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE=true` is used, receipt storage is explicitly not verified. This smoke also does not prove a full authenticated Expense Report submission path.

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

Check services:

```bash
aws ecs describe-services \
  --profile expenseflow-smoke \
  --region us-east-1 \
  --cluster expenseflow-sandbox \
  --services expenseflow-core-case-service expenseflow-gl-coding-service \
  --query 'services[].{name:serviceName,status:status,running:runningCount,desired:desiredCount}'
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
CONFIRM_RESOURCE_TEARDOWN=SCRUM-147 \
VPC_ID="$VPC_ID" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/tear-down-runtime-smoke-resources.sh
```

The teardown script scales down and deletes ECS services, stops remaining smoke tasks, deletes public and internal ALB listeners/rules, deletes both ALBs and target groups, deregisters and deletes task-definition revisions where AWS permits it, deletes the ECS cluster, deletes ECR repositories and pushed images, force-deletes the Secrets Manager entries, deletes CloudWatch log groups, deletes security groups, removes IAM role policies and roles, and deletes rendered task-definition output under `/tmp`.
