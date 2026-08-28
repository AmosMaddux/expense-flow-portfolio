# ExpenseFlow Sandbox Infrastructure

This is the operational entry point for the Terraform-managed ExpenseFlow
sandbox. Use it to deploy the AWS demo environment, sign in to the seeded app,
and tear the environment down when you are done.

Run commands from the repository root unless a step explicitly says otherwise.
The sandbox creates real AWS resources and may incur charges.

## Terraform Module Structure

The sandbox runtime lives under `infra/terraform/environments/sandbox`.
Persistent demo ECR repositories live under
`infra/terraform/environments/sandbox-ecr` so teardown can remove costly
runtime resources without deleting reusable image storage.
`infra/terraform/bootstrap` owns only the remote Terraform state bucket.

| Module | Purpose |
| --- | --- |
| `network` | Discovers the existing sandbox VPC/subnets by default, or creates a managed VPC when configured. |
| `alb` | Creates the public ALB for Core Case and the internal ALB for GL-coding. |
| `sandbox-ecr` root | Creates or adopts the persistent ECR repositories used by demo image builds. |
| `ecs` | Creates the ECS cluster, Core Case and GL-coding services, task definitions, log groups, receipt bucket, DynamoDB table, and stage-transition SNS/SQS resources. |
| `database` | Creates private RDS PostgreSQL with RDS-managed master credentials and database roles/extensions. |
| `redis` | Creates the private Redis/ElastiCache runtime dependency for Core Case. |
| `bastion` | Creates the SSM-only EC2 bastion used for migrations, seeding, and MFA code generation. |
| `lambda-stage-transition-consumer` | Creates the container-image Lambda that consumes stage-transition SQS events. |
| `http-api` | Creates API Gateway and Lambda endpoints for claims probe and issue payment flows. |
| `spa` | Creates the private SPA bucket and CloudFront distribution. |

The runtime root consumes ECR repository URLs and ARNs from the persistent ECR
root. It does not own repository lifecycle.

## Prerequisites

Install and configure these before deploying:

- AWS CLI authenticated to the `expenseflow-smoke` profile.
- Terraform `>= 1.7.0`.
- Docker with Buildx support.
- AWS SAM CLI.
- Node.js `>= 24`.
- `jq`.
- OpenSSL.
- AWS Session Manager plugin (`session-manager-plugin`).
- `nc` (netcat).
- Trivy, Syft, and Cosign for the secure image build path.

The scripts default to `AWS_PROFILE=expenseflow-smoke` and
`AWS_REGION=us-east-1`. They refuse other profiles unless
`ALLOW_NON_SMOKE_PROFILE=true` is set.

Terraform state uses the S3 backend created by `infra/terraform/bootstrap`.
Before the first sandbox deploy on a machine, make sure
`infra/terraform/environments/sandbox/backend.hcl` exists, points at the
bootstrap state bucket, and the sandbox backend has been initialized.

AI agent caveat: `deploy-demo.sh` and `tear-down-demo.sh` call
`aws secretsmanager get-secret-value` internally and hold plaintext secrets in
local shell variables. A human may run those scripts from their own shell, but
an AI agent must not run them end-to-end under this repository's secret safety
rules.

## Sign In Instructions

Use the CloudFront SPA URL printed by `deploy-demo.sh` after a successful deploy,
or resolve it again with Terraform when you need it. The demo script also prints
the public Core Case API ALB URL used for sandbox smoke/debug.

### Retrieve The CloudFront URL

Command:

```bash
printf 'https://%s\n' "$(AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output -raw spa_cloudfront_domain_name)"
```

What it does: prints the CloudFront URL for the deployed SPA.

### Retrieve The Core Case API Gateway URL

Command:

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_api_gateway_base_url
```

What it does: prints the HTTPS API Gateway origin that the CloudFront SPA uses
for browser-safe `/v1/*` Core Case requests.

### Retrieve The Direct Public ALB Origin

Command:

```bash
printf 'http://%s\n' "$(AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output -raw public_alb_dns_name)"
```

What it does: prints the public HTTP ALB origin behind the API Gateway proxy.
This remains directly reachable in the small sandbox setup. A future private
version should move API Gateway to a VPC Link integration with the internal ALB.

All seeded accounts use this synthetic password:

```text
expenseflow-local-dev-only
```

### Generate An MFA Code

Command:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh code finance-admin
```

What it does: generates the 6-digit MFA code for the seeded `finance-admin`
account through the SSM-only bastion. Enter the code immediately because TOTP
codes rotate every 30 seconds.

You can replace `finance-admin` with `employee`, `manager`, `platform-admin`,
or a full account alias such as `employee-1`, `manager-1`,
`finance-admin-2`, or `platform-admin-1`.

Seeded accounts:

| Account | Email | Role | Tenant |
| --- | --- | --- | --- |
| `employee-1` | `employee@example1.invalid` | Employee | primary |
| `employee-1b` | `employee2@example1.invalid` | Employee | primary |
| `employee-2` | `employee@example2.invalid` | Employee | secondary |
| `employee-2b` | `employee2@example2.invalid` | Employee | secondary |
| `manager-1` | `manager@example1.invalid` | Department Manager | primary |
| `manager-2` | `manager@example2.invalid` | Department Manager | secondary |
| `finance-admin-1` | `finance-admin@example1.invalid` | Finance Admin | primary |
| `finance-admin-2` | `finance-admin@example2.invalid` | Finance Admin | secondary |
| `platform-admin-1` | `platform-admin@example1.invalid` | Admin | primary |
| `platform-admin-2` | `platform-admin@example2.invalid` | Admin | secondary |

The demo Expense Report seeded by `demo-seed` is in the primary tenant, so use
a `-1` account to see it.

## Deploy Demo Instructions

### Deploy The Demo Environment

Command:

```bash
AWS_PROFILE=expenseflow-smoke \
AWS_REGION=us-east-1 \
AUTO_APPROVE=true \
scripts/aws/e2e/deploy-demo.sh
```

What it does: runs the full scripted demo deploy. It generates sandbox secrets,
deploys the JWT issuer, applies the persistent ECR root, imports existing ECR
repositories into that root when needed, builds and pushes images, applies
runtime Terraform, deploys the SPA, runs migrations and demo seeding through
the bastion, and runs the ZAP API scan.

The script is idempotent and safe to rerun. It deploys real, billed AWS
infrastructure and does not tear anything down afterward.

Optional environment variables:

| Variable | Default | Use |
| --- | --- | --- |
| `IMAGE_TAG` | `demo-<UTC timestamp>` | Tag for all pushed images. |
| `SKIP_SPA_DEPLOY` | `false` | Skip SPA build/deploy when only backend infrastructure or images need redeploying. |
| `SKIP_BASTION_SEED` | `false` | Skip migrations and seed commands. |
| `SKIP_ZAP_SCAN` | `false` | Skip the ZAP API scan. |
| `VITE_TENANT_ID` | Primary synthetic tenant ID | Tenant baked into the SPA build. |
| `HTTP_API_LAMBDA_VPC_ID` | Discovered from `EXISTING_VPC_NAME` | Override the VPC used by the Issue Payment Lambda. |
| `EXISTING_VPC_NAME` | `project-vpc` | Existing sandbox VPC `Name` tag used when discovering `HTTP_API_LAMBDA_VPC_ID`. |
| `RUN_READONLY_ROLE_STEP` | `true` | Apply GL-coding's readonly database role and the `vector` extension through a bastion SSM tunnel. Set to `false` only for a partial deploy where GL-coding is intentionally not verified. |
| `READONLY_ROLE_STEP_LOCAL_PORT` | `15432` | Local port for the readonly-role SSM tunnel. |
| `ZAP_IMAGE` | Pinned `ghcr.io/zaproxy/zaproxy` digest | Override the ZAP scan container image. |

## Tear Down Instructions

### Tear Down The Demo Environment

Command:

```bash
AWS_PROFILE=expenseflow-smoke \
AWS_REGION=us-east-1 \
AUTO_APPROVE=true \
scripts/aws/e2e/tear-down-demo.sh
```

What it does: tears down the costly runtime resources from the demo
environment. It empties the SPA and receipt S3 buckets, preserves the three
demo ECR repositories and their images, runs Terraform destroy through the
bastion tunnel when needed, force-deletes ephemeral runtime secrets so their
names can be reused, and deletes the JWT issuer CloudFormation stack.

The teardown does not remove:

- The Terraform bootstrap state bucket.
- The three demo ECR repositories or their images.
- The SAM deployment artifact bucket used by the JWT issuer.
- Older CloudFormation stacks that predate this deploy flow.

This runs a real Terraform destroy against real AWS infrastructure. Nothing
it destroys is reversible.

## Troubleshooting

### `Invalid count argument` During ALB Planning

Cause: an older version of the sandbox Terraform tried to decide an ALB
security group rule count from a Lambda security group ID that was unknown
until apply.

Fix: rerun `deploy-demo.sh` from a branch that includes the plan-stable ALB
security group rule fix.

### ECR Repository Is Not Empty During Teardown

Cause: a plain Terraform destroy tried to delete ECR repositories that still
contained images.

Fix: use `scripts/aws/e2e/tear-down-demo.sh`. The teardown script preserves
ECR repositories and images because their storage cost is tiny and the images
are useful for later deploys.

### ECR Repository Already Exists During Deploy

Cause: a persistent demo ECR repository exists in AWS but has not yet been
adopted into the separate `sandbox-ecr` Terraform state.

Fix: rerun `deploy-demo.sh`. The script imports existing ECR repositories into
the persistent ECR root before applying that root.

### Terraform Provider Schema Loading Fails

Cause: the local `.terraform` provider cache is stale, incomplete, or contains
provider binaries that cannot start on this machine.

Fix: refresh the sandbox providers with Terraform init, then rerun the script.

### Secrets Manager Says A Secret Is Scheduled For Deletion

Cause: a previous teardown scheduled an ephemeral runtime secret for deletion,
and AWS still reserves the name during the recovery window.

Fix: rerun `tear-down-demo.sh`. The script force-deletes the fixed runtime
secret names without a recovery window and waits briefly for those names to
become reusable.

### `backend.hcl` Is Missing

Cause: the local sandbox backend config has not been created for this machine.

Fix: create `infra/terraform/environments/sandbox/backend.hcl` from the
example, set the bucket to the bootstrap state bucket, initialize the sandbox
backend, then rerun `deploy-demo.sh`.

### AWS Profile Is Rejected

Cause: the scripts default to the `expenseflow-smoke` sandbox profile and
refuse other profiles by default.

Fix: use `AWS_PROFILE=expenseflow-smoke`, or set
`ALLOW_NON_SMOKE_PROFILE=true` only when you intentionally target a different
AWS account.

### Issue Payment Lambda Cannot Reach Core Case

Cause: the Lambda must run in the sandbox VPC to call Core Case through the
internal ALB.

Fix: rerun `deploy-demo.sh`. The script discovers the default sandbox VPC by
`Name=project-vpc` and `env=sandbox`. If discovery is wrong for your account,
set `HTTP_API_LAMBDA_VPC_ID` and rerun the script.

### VPC Discovery Fails With RequestExpired

Cause: AWS rejected the signed `DescribeVpcs` request before the script could
inspect VPC tags. This usually means the local clock is skewed or the
`expenseflow-smoke` profile credentials have expired.

Fix: refresh the AWS profile credentials, verify the local UTC clock is
synchronized, and rerun `deploy-demo.sh`.

### GL-Coding Tasks Stay Unhealthy

Cause: GL-coding's readonly database role and the `vector` extension require
Terraform's PostgreSQL provider to reach private RDS through the bastion. If
`RUN_READONLY_ROLE_STEP=false` was used, GL-coding's readonly role secret may
not have an `AWSCURRENT` value, so ECS cannot start the GL-coding task.

Fix: rerun `deploy-demo.sh` with `RUN_READONLY_ROLE_STEP=true`, or omit the
variable because it is the default. Add `SKIP_SPA_DEPLOY=true`,
`SKIP_BASTION_SEED=true`, and `SKIP_ZAP_SCAN=true` if you only want to complete
the database role/extension step.

### Terraform Plans To Destroy PostgreSQL Role Or Extension

Cause: once `module.database_core_case.postgresql_role.*` or
`module.database_core_case.postgresql_extension.*` exists in Terraform state,
Terraform must refresh it through the PostgreSQL provider before any later
apply can finish. A plan that says it will destroy the readonly role or
`vector` extension, followed by a private RDS timeout, means the apply is
running without the bastion tunnel while those database-managed resources are
still in state.

Fix: rerun `deploy-demo.sh` with `RUN_READONLY_ROLE_STEP=true`, or omit the
variable because it is the default. The script detects PostgreSQL resources in
state and routes the full apply through the bastion tunnel before Terraform can
plan a premature destroy.

### ZAP Scan Fails After Deploy

Cause: `deploy-demo.sh` runs a ZAP API scan against the deployed Core Case
OpenAPI document and exits non-zero on High-severity findings.

Fix: inspect `evidence/secure-release-gate/core-case-service-zap-report.json`.
The environment is already deployed when this happens; teardown is a separate
explicit step.

### MFA Code Does Not Work

Cause: TOTP codes rotate every 30 seconds, or the wrong account alias was used.

Fix: rerun `scripts/aws/bastion-run.sh code <account>` and enter the newest
code immediately. Use a `-1` account for the primary tenant demo data.
