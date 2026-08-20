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
- Trivy, Syft, and Cosign, used by the secure release gate (see
  [docs/secure-release-gate.md](../../docs/secure-release-gate.md)). Cosign's
  default keyless signing opens a browser to authenticate a Sigstore
  identity; set `COSIGN_KEY`/`COSIGN_PASSWORD` to sign with a key pair
  instead.

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
- `PUBLIC_ALB_CERTIFICATE_ARN`: ACM certificate ARN for the internet-facing ALB HTTPS listener.
- `RUNTIME_SMOKE_SOURCE_CIDRS`: comma-separated CIDR allowlist for `/v1/runtime-smoke/*`.
- `ROLE_PERMISSIONS_BOUNDARY_ARN`: permissions boundary ARN required for sandbox IAM roles.

The scripts reject `localhost` and `127.0.0.1` for these values because each Fargate task has its own network namespace.

`GL_CODING_SERVICE_BASE_URL` is required when registering task definitions. Use the internal GL-coding ALB DNS printed by the resource script:

```bash
GL_CODING_SERVICE_BASE_URL="http://<internal-gl-coding-alb-dns>"
```

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
REDIS_URL="$REDIS_URL" \
VPC_ID="$VPC_ID" \
PUBLIC_SUBNETS="$PUBLIC_SUBNETS" \
INTERNAL_SUBNETS="${INTERNAL_SUBNETS:-$PUBLIC_SUBNETS}" \
PUBLIC_ALB_CERTIFICATE_ARN="$PUBLIC_ALB_CERTIFICATE_ARN" \
RUNTIME_SMOKE_SOURCE_CIDRS="$RUNTIME_SMOKE_SOURCE_CIDRS" \
ROLE_PERMISSIONS_BOUNDARY_ARN="$ROLE_PERMISSIONS_BOUNDARY_ARN" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/create-runtime-smoke-resources.sh
```

This creates or updates the AWS resources that the task definitions need:

- ECR repositories
- ECS cluster
- CloudWatch log groups
- Internet-facing Application Load Balancer
- HTTP listener that redirects to HTTPS
- HTTPS listener with `/v1` and `/v1/*` routing to Core Case
- Source-restricted HTTPS listener rules for `/v1/runtime-smoke/*`
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

After each image is pushed, the script runs the secure release gate against
the pushed image reference: a Trivy scan that fails the script on any
`CRITICAL` CVE, a Syft CycloneDX SBOM, and a Cosign signature and SBOM
attestation. The Trivy report and SBOM are written under
`evidence/secure-release-gate/` (override with
`SECURE_RELEASE_GATE_EVIDENCE_DIR`) for the release's evidence packet. See
[docs/secure-release-gate.md](../../docs/secure-release-gate.md).

### 3. Register Task Definitions

Before rendering task definitions, this script runs
`scripts/aws/verify-image-signatures.sh` against `CORE_CASE_IMAGE_URI` and
`GL_CODING_IMAGE_URI` and refuses to register a task definition if either
image's Cosign signature or CycloneDX SBOM attestation does not verify. Set
`COSIGN_CERTIFICATE_IDENTITY_REGEXP` and `COSIGN_CERTIFICATE_OIDC_ISSUER` to
match the identity that ran `build-push-images.sh` (or `COSIGN_KEY` if it
signed with a key pair).

```bash
CORE_CASE_DATABASE_URL="$CORE_CASE_DATABASE_URL" \
GL_CODING_DATABASE_URL="$GL_CODING_DATABASE_URL" \
GL_CODING_SERVICE_BASE_URL="$GL_CODING_SERVICE_BASE_URL" \
REDIS_URL="$REDIS_URL" \
SPA_ORIGIN="https://dzw2h7jwg14u1.cloudfront.net" \
RUNTIME_SMOKE_GL_CODING_ENABLED=true \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/register-task-definitions.sh
```

This renders the portable task-definition templates with real AWS values, then registers:

- `expenseflow-core-case-service`
- `expenseflow-gl-coding-service`

The registration script resolves the stage-transition SNS topic and runtime
smoke shared-secret ARN after the resource script creates them. The committed
task template defaults the runtime smoke route to disabled; set
`RUNTIME_SMOKE_GL_CODING_ENABLED=true` only for this sandbox ALB smoke flow.

`GL_CODING_SERVICE_BASE_URL` and `REDIS_URL` must be ECS-reachable endpoints such as Cloud Map, ECS Service Connect, or internal load balancer DNS names. The registration script rejects `localhost` and `127.0.0.1` for those cross-task dependencies because each Fargate task has its own network namespace.

Rendered task-definition JSON is written to `/tmp/expenseflow-scrum-147-task-definitions` by default because it contains account-specific ARNs and ECR image URIs.

Validate template rendering locally without registering task definitions:

```bash
CORE_CASE_DATABASE_URL="postgres://db-user:db-pass@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_DATABASE_URL="postgres://db-user:db-pass@postgres.expenseflow-sandbox.local:5432/expenseflow_sandbox" \
GL_CODING_SERVICE_BASE_URL="http://internal-gl-coding-alb.expenseflow-sandbox.local" \
REDIS_URL="redis://redis.expenseflow-sandbox.local:6379" \
SPA_ORIGIN="https://spa.example.invalid" \
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

Core Case is attached to the public ALB target group, and the public ALB HTTPS listener routes `/v1` and `/v1/*` to Core Case. The public ALB HTTP listener redirects to HTTPS. GL-coding is attached to an internal ALB target group, so Core Case calls GL-coding through the internal ALB instead of exposing GL-coding on the public ALB.

The services are not autoscaled by these scripts. They use `DESIRED_COUNT`, which defaults to `1`, and ECS replaces unhealthy tasks behind the ALB target groups.

### 5. Run The ALB Smoke

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/run-task-smoke.sh
```

This validates ALB-backed ECS services and calls the public ALB over HTTPS. `PUBLIC_ALB_SMOKE_BASE_URL` is required and must be the HTTPS hostname covered by the ACM certificate; the AWS-generated ALB DNS name normally will not pass TLS hostname verification.
If the sandbox AWS Organizations policy still blocks creation of the dedicated
receipt bucket, run the ALB-only smoke with:

```bash
ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE=true \
PUBLIC_ALB_SMOKE_BASE_URL="https://<certificate-covered-public-hostname>" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/run-task-smoke.sh
```

Expected result:

- Preflight confirms ALB, listener rules, target groups, ECS service load balancer attachments, task roles, and runtime resources are present.
- Public Core Case and internal GL-coding target groups each report at least one healthy target.
- Healthy target IPs match running task ENI private IPs for the named ECS services.
- `https://<public-alb-origin>/v1/openapi.json` returns HTTP 200 and contains Core Case OpenAPI paths.
- `https://<public-alb-origin>/v1` reaches Core Case instead of the ALB default 404.
- `https://<public-alb-origin>/v1/runtime-smoke/gl-coding` returns HTTP 200 after the smoke script supplies the Secrets Manager-backed token and Core Case calls GL-coding through its configured base URL.
- A temporary ECS smoke task calls `http://<internal-gl-coding-alb-dns>/health` and receives HTTP 200.

This proves ECS services can run on Fargate behind ALBs, target-group health gates service readiness for the named ECS services, the public ALB routes `/v1` and `/v1/*` to Core Case over HTTPS, Core Case is configured to reach GL-coding, and the internal ALB is reachable from the Core Case network path. The Core Case runtime-smoke route remains disabled unless the task definition is explicitly rendered with `RUNTIME_SMOKE_GL_CODING_ENABLED=true`, requests require the runtime smoke token generated by the resource script, and the public ALB only forwards that path from `RUNTIME_SMOKE_SOURCE_CIDRS`. When `ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE=true` is used, receipt storage is explicitly not verified. This smoke also does not prove a full authenticated Expense Report submission path.

## Terraform Sandbox End-to-End Smoke

`scripts/aws/run-terraform-e2e-smoke.sh` is the smoke test for the Terraform-managed sandbox (`infra/terraform/environments/sandbox`), not the bash-provisioned resources above. Unlike every other script in this directory, it does not hardcode resource names — it reads `terraform output -json` for every identifier it can, so it stays correct as the Terraform modules change. Run `terraform apply` in `infra/terraform/environments/sandbox` first.

It runs three checks in one invocation:

1. **ALB request → Core Case**: wraps `run-task-smoke.sh`, passing in the Terraform-managed ALB/target-group names and cluster/subnet/bucket/table identifiers instead of that script's own hardcoded defaults (which target the older bash-provisioned names and do not match the Terraform module's shortened ALB/target-group names).
2. **API Gateway payment path → Lambda → Core Case internal route**: wraps `scripts/aws/SCRUM-150/smoke-issue-payment-http-api.sh`, building `ISSUE_PAYMENT_URL` from the Terraform `http_api_issue_payment_url_prefix` output.
3. **SQS event flow**: publishes a synthetic stage-transition CloudEvent to the Terraform-managed SNS topic, then polls the Postgres `stage_transition_projection` table (via the stage-transition consumer Lambda's own `database_url` Secrets Manager secret) and Lambda invocation metrics to prove SNS → SQS → Lambda → Postgres runs end to end.

```bash
PUBLIC_ALB_SMOKE_BASE_URL="https://<certificate-covered-public-hostname>" \
VALID_ACCESS_TOKEN="$VALID_ACCESS_TOKEN" \
EXPIRED_ACCESS_TOKEN="$EXPIRED_ACCESS_TOKEN" \
EXPENSE_REPORT_ID="$EXPENSE_REPORT_ID" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/run-terraform-e2e-smoke.sh
```

`PUBLIC_ALB_SMOKE_BASE_URL` has the same TLS-hostname requirement as `run-task-smoke.sh`. `VALID_ACCESS_TOKEN`/`EXPIRED_ACCESS_TOKEN` must be minted by the same JWT issuer configured on the HTTP API's authorizer (`http_api_jwt_issuer`/`http_api_jwt_audience`) — Terraform does not mint tokens. The event-flow check requires a synthetic `expense_report` row to already exist for `SYNTHETIC_EXPENSE_REPORT_ID`/`SYNTHETIC_TENANT_ID` (defaults provided; override to point at seeded data) and reads the database URL via Secrets Manager, never as a plaintext argument.

Any of the three checks can be skipped independently: `RUN_ALB_SMOKE=false`, `RUN_PAYMENT_SMOKE=false`, `RUN_EVENT_FLOW_SMOKE=false`.

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

## Ticket Teardown Orchestrator

The master ticket teardown script discovers `tear-down-*.sh` scripts under
`scripts/aws/SCRUM-*` directories and runs them newest ticket first. Each ticket
script still receives its own `CONFIRM_RESOURCE_TEARDOWN=<ticket>` value.

Preview without deleting resources:

```bash
CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN=ALL-SCRUM \
DRY_RUN=true \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/tear-down-scrum-ticket-resources.sh
```

Run all discovered ticket teardowns:

```bash
CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN=ALL-SCRUM \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/tear-down-scrum-ticket-resources.sh
```

Limit teardown to selected tickets:

```bash
CONFIRM_ALL_SCRUM_RESOURCE_TEARDOWN=ALL-SCRUM \
TICKETS=SCRUM-150,SCRUM-149 \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/tear-down-scrum-ticket-resources.sh
```
