# ExpenseFlow Sandbox Infrastructure

This is the operational entry point for the Terraform-managed ExpenseFlow
sandbox. Use it when you need to create the sandbox infrastructure, deploy the
application images, publish the SPA, seed demo data, and sign in.

Run commands from the repository root unless a step explicitly says otherwise.
The sandbox creates real AWS resources and may incur charges.

## Using An AI Agent To Spin Up Or Tear Down

You can tell an AI coding agent (Claude Code or similar) to "follow the
instructions in `infra/terraform/README.md` to spin up the sandbox" or "...to
tear it down," and it can drive most of the work: resolving Terraform
outputs, running the read-only and non-secret parts of each script, checking
results, and telling you what to run next. But **neither
`scripts/aws/e2e/deploy-demo.sh` nor `scripts/aws/e2e/tear-down-demo.sh` can
be handed to an agent to run end-to-end unsupervised** - both call
`aws secretsmanager get-secret-value` directly and hold the plaintext result
in a shell variable, which is a hard line for an agent under this
repository's AWS Secret Safety rule (`AGENTS.md`), even though it is a
completely ordinary thing for a human to do from their own shell:

- **`deploy-demo.sh`** does this unconditionally in its image-build step
  (Cosign's signing key/password, needed because keyless OIDC signing can't
  run unattended) - this happens early, in the default path, not only when
  `RUN_READONLY_ROLE_STEP=true` is set. `RUN_READONLY_ROLE_STEP=true` adds a
  second instance (the RDS master password) later in the same run.
- **`tear-down-demo.sh`** does this once, for the same RDS master password,
  as an unconditional part of its `terraform destroy` step - not opt-in the
  way `RUN_READONLY_ROLE_STEP` is on the deploy side.

The rule itself: an AI agent must never call `secretsmanager get-secret-value`
(or `batch-get-secret-value`) and hold the plaintext result itself, even
briefly, even without printing it — the rule is about the value ever
entering the agent's own process, not just about it appearing in terminal
output. A human running the same command from their own shell is not bound
by that rule; an agent is. This is the same boundary `asm-exec` (the
approved agent-safe alternative — see
`infra/terraform/modules/database/README.md`) exists to work around when
it's installed; treat its absence the same way whether or not it happens to
be present.

In practice: ask an agent to run `deploy-demo.sh` or `tear-down-demo.sh` and
it should tell you this and hand you the exact command to run yourself,
rather than invoking either script itself. It can still do essentially
everything else in this document - reading Terraform outputs, running
`bastion-run.sh` operations, checking on ECS/ALB health, and so on.

## Overview

The sandbox runs the ExpenseFlow demo environment in AWS:

- CloudFront serves the React SPA from a private S3 bucket and proxies `/v1/*`
  API traffic to the public ALB.
- The public ALB routes Core Case API traffic to an ECS Fargate service.
- Core Case talks to RDS PostgreSQL, Redis, and GL-coding.
- GL-coding runs as a separate ECS Fargate service behind an internal ALB.
- A permanent SSM-only bastion runs operational tasks such as migrations,
  account seeding, demo-data seeding, and MFA code generation.
- API Gateway and Lambda host the narrow HTTP API endpoints that do not run in
  Core Case.
- SNS, SQS, and a Lambda image consumer support stage-transition projection
  flow.

At a high level:

```text
Browser
  |
  v
CloudFront
  |-- S3 private bucket for SPA static files
  |
  `-- /v1/* to public ALB
          |
          v
      Core Case ECS service
          |-- RDS PostgreSQL
          |-- Redis
          |-- internal ALB to GL-coding ECS service
          `-- SNS/SQS stage-transition flow
```

Terraform owns the sandbox runtime under
`infra/terraform/environments/sandbox`. The bootstrap stack under
`infra/terraform/bootstrap` owns only the remote Terraform state bucket.

## Terraform Modules

| Module | Purpose |
| --- | --- |
| `network` | Discovers the existing sandbox VPC/subnets by default, or creates a managed VPC when `network_mode = "managed"`. |
| `alb` | Creates the public ALB for Core Case and the internal ALB for GL-coding. |
| `ecs` | Creates the ECS cluster, Core Case and GL-coding task definitions/services, ECR repositories, log groups, receipt bucket, DynamoDB read-projection table, and stage-transition SNS/SQS resources. |
| `database` | Creates private RDS PostgreSQL with RDS-managed master credentials and the GL-coding readonly database role. |
| `redis` | Creates the private Redis/ElastiCache runtime dependency for Core Case. |
| `bastion` | Creates the SSM-only EC2 bastion used for operational commands. |
| `lambda-stage-transition-consumer` | Creates the container-image Lambda that consumes stage-transition SQS events. |
| `http-api` | Creates API Gateway and Lambda endpoints for HTTP API functionality such as claims probe and issue payment. |
| `spa` | Creates the private SPA bucket and CloudFront distribution. |

## Sign In And Validate

Get the SPA URL:

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output -raw spa_cloudfront_domain_name
```

Open `https://<spa_cloudfront_domain_name>`.

All seeded accounts use this synthetic password:

```text
expenseflow-local-dev-only
```

After entering email and password, generate the MFA code from the bastion:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh code finance-admin
```

Replace `finance-admin` with the alias or account name you are signing in as,
such as `employee`, `manager`, `platform-admin`, `employee-1`, or
`finance-admin-2`. The script resolves the needed Terraform outputs, MFA secret
ARN, and Core Case image tag automatically. Enter the printed 6-digit TOTP code
immediately because codes rotate every 30 seconds.

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

The demo expense report seeded by `demo-seed` is in the primary tenant, so use
a `-1` account to see it.

For deeper runtime validation after a full apply, use the Terraform smoke test
documented in `scripts/aws/README.md`:

```bash
AWS_PROFILE=expenseflow-smoke \
  scripts/aws/e2e/run-deployed-smoke.sh
```

The wrapper resolves Terraform outputs, derives the ALB smoke URL, mints
synthetic valid/expired JWTs, and selects seeded synthetic Expense Report IDs.
If it reports that runtime-smoke is not enabled, run:

```bash
AWS_PROFILE=expenseflow-smoke \
  AUTO_APPROVE=true \
  scripts/aws/e2e/prepare-smoke-prereqs.sh
```

Then re-run `scripts/aws/e2e/run-deployed-smoke.sh`.

## Tear Down

`scripts/aws/e2e/tear-down-demo.sh` tears down everything `deploy-demo.sh`
creates: it empties the SPA and receipt S3 buckets and the three ECR
repositories (none of them have `force_destroy`/`force_delete` set, so a
plain `terraform destroy` fails on all three otherwise), runs
`terraform destroy` through the same bastion SSM tunnel pattern as
`RUN_READONLY_ROLE_STEP` (required even if that step was never used - once
`postgresql_role`/`postgresql_extension` exist in state, every plan or
destroy needs the tunnel to refresh them), and deletes the JWT issuer
CloudFormation stack.

```bash
AWS_PROFILE=expenseflow-smoke \
  AUTO_APPROVE=true \
  scripts/aws/e2e/tear-down-demo.sh
```

Requires the AWS Session Manager plugin, `nc`, and AWS credentials with
`ssm:StartSession` on the bastion - the same prerequisites as
`RUN_READONLY_ROLE_STEP=true`.

This does **not** touch: `infra/terraform/bootstrap` (owns the Terraform
state bucket - keep it so the next `deploy-demo.sh` run has somewhere to
store state), or `expenseflow-platform-bootstrap-sandbox` (the JWT issuer's
own SAM deployment-artifact bucket, reused across every JWT issuer deploy).
The script's own header comment also flags two older CloudFormation stacks
found in this account (`expenseflow-http-api-sandbox`,
`expenseflow-jwt-issuer-sandbox`) that predate this bastion/deploy-demo.sh
setup and aren't referenced by any script in this flow - it does not touch
them either, and they should be investigated separately before deleting.

This runs a real `terraform destroy` against real, billed AWS
infrastructure. Nothing here is reversible.

To redeploy from scratch after tearing down, just run `deploy-demo.sh`
again (see "Spin Up With Scripts" below) - `backend.hcl` and any local
Terraform config are untouched by teardown, so no reconfiguration is
needed.

## Prerequisites

Install and configure these before starting:

- AWS CLI authenticated to the `expenseflow-smoke` profile.
- Terraform `>= 1.6.0`.
- Docker with Buildx support.
- AWS SAM CLI, used by the JWT issuer packaging flow.
- Node.js `>= 24`.
- `jq`.
- OpenSSL.
- AWS Session Manager plugin (`session-manager-plugin`), required for SSM
  port forwarding to the bastion - needed for
  `RUN_READONLY_ROLE_STEP=true` (see "Finish The GL-Coding Readonly Role"
  below), `tear-down-demo.sh` (see "Tear Down" above), and for any bastion
  operation.
- `nc` (netcat), required by `RUN_READONLY_ROLE_STEP=true` and
  `tear-down-demo.sh` to detect when their SSM tunnel is ready.
- Trivy, Syft, and Cosign when using the secure image build script.
- OWASP ZAP is not installed locally - `deploy-demo.sh`'s ZAP scan step runs
  it via `docker run` against the pinned `ZAP_IMAGE`, so only Docker is
  required for that step.

Verify AWS access first:

```bash
AWS_PROFILE=expenseflow-smoke AWS_REGION=us-east-1 \
  aws sts get-caller-identity
```

Most AWS helper scripts default to profile `expenseflow-smoke` and region
`us-east-1`. They refuse other profiles unless
`ALLOW_NON_SMOKE_PROFILE=true` is set.

## Required Configuration

### Remote State

Terraform state is stored in the S3 bucket created by
`infra/terraform/bootstrap`. The sandbox backend expects a local
`infra/terraform/environments/sandbox/backend.hcl` file created from the
example:

```bash
cp infra/terraform/environments/sandbox/backend.hcl.example \
  infra/terraform/environments/sandbox/backend.hcl
```

Edit `backend.hcl` and set `bucket` to the `state_bucket_name` output from the
bootstrap stack. `backend.hcl` is ignored by git and must not be committed.

### Sandbox Variables

**Only needed for the "Spin Up Manually" path below.** The recommended
scripted path (`deploy-demo.sh`, see "Spin Up With Scripts") passes every
required value to Terraform as `-var` arguments itself and never reads
`terraform.tfvars` - skip this section entirely if you're following that
path.

Create `infra/terraform/environments/sandbox/terraform.tfvars` from the
example:

```bash
cp infra/terraform/environments/sandbox/terraform.tfvars.example \
  infra/terraform/environments/sandbox/terraform.tfvars
```

Paste these required runtime values into `terraform.tfvars`:

```hcl
core_case_auth_jwt_private_key_secret_arn           = "<from generate-sandbox-secrets.sh>"
gl_coding_auth_jwt_public_keys_json_secret_arn      = "<from generate-sandbox-secrets.sh>"
core_case_mfa_totp_secret_encryption_key_secret_arn = "<from generate-sandbox-secrets.sh>"
core_case_internal_command_token_secret_arn         = "<from generate-sandbox-secrets.sh>"
http_api_jwt_issuer                                 = "<IssuerUrl from deploy-jwt-issuer.sh>"
```

The secret variables must be Secrets Manager ARNs only. Do not paste secret
values into Terraform files, terminal output, docs, or logs.

For the `expenseflow-smoke` sandbox account, also set these values:

```hcl
aws_region  = "us-east-1"
aws_profile = "expenseflow-smoke"

allow_plain_http_public_api       = true
enable_nat_gateway                = false
db_enable_enhanced_monitoring     = false
core_case_internal_routes_enabled = true

role_permissions_boundary_arn = "arn:aws:iam::ACCOUNT_ID:policy/TraineeSandboxBoundary"
http_api_lambda_vpc_id        = "vpc-xxxxxxxx"
```

After images are pushed, also set the image URIs:

```hcl
core_case_image_uri = "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/expenseflow-sandbox-core-case-service:<tag>"
gl_coding_image_uri = "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/expenseflow-sandbox-gl-coding-service:<tag>"
stage_transition_lambda_image_uri = "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/expenseflow-sandbox-stage-transition-consumer-lambda:<tag>"
```

To find the existing sandbox VPC ID when using the default discovered network:

```bash
AWS_PROFILE=expenseflow-smoke AWS_REGION=us-east-1 \
  aws ec2 describe-vpcs \
  --filters Name=tag:Name,Values=project-vpc \
  --query 'Vpcs[0].VpcId' \
  --output text
```

## Spin Up With Scripts

This is the recommended path for a new developer.

`scripts/aws/e2e/deploy-demo.sh` runs the main deployment flow in order:

1. Generates or rotates the required sandbox secrets.
2. Packages and deploys the JWT issuer stack.
3. Creates the ECR repositories with a targeted Terraform apply.
4. Builds and pushes Core Case, GL-coding, and stage-transition Lambda images.
5. Runs the full Terraform apply. GL-coding's readonly database role and the
   `vector` extension are always skipped here (see "Finish The GL-Coding
   Readonly Role" below) - this step alone never fully provisions a working
   environment.
6. Optionally applies GL-coding's readonly role and the `vector` extension,
   only when `RUN_READONLY_ROLE_STEP=true` - opens its own SSM tunnel to the
   bastion, applies, and tears the tunnel down. Skipped by default.
7. Builds and deploys the SPA to S3 and CloudFront.
8. Runs migrations, account seeding, and demo-data seeding through the
   bastion.
9. Runs a ZAP API scan against the deployed Core Case Service's OpenAPI
   document and fails the script on any High-severity finding - see
   `docs/secure-release-gate.md`'s "ZAP" section. The report lands at
   `evidence/secure-release-gate/core-case-service-zap-report.json`; a
   finding here does not undo the deploy, and the summary below still
   prints before the script exits non-zero.

The script's own `=== N/M ===` progress messages number these steps
differently (skipping numbers, reusing `5b`) - the list above is the
accurate order; the printed numbers are cosmetic only.

The script is idempotent and safe to re-run, but it deploys real, billed AWS
infrastructure. It does not tear the environment down. On a brand-new
environment, expect to run it twice: once for steps 1-5 and 7-9 (the
default), then once more with `RUN_READONLY_ROLE_STEP=true` (or the manual
path below) to complete step 6 - GL-coding's ECS tasks will not go healthy
and Core Case's pgvector-backed policy retrieval will not work until that
step has run at least once against a given environment.

### One-Time Bootstrap

Run this once if the remote state bucket does not exist:

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/bootstrap init

AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/bootstrap apply
```

Copy the printed `state_bucket_name`, then create and edit `backend.hcl`:

```bash
cp infra/terraform/environments/sandbox/backend.hcl.example \
  infra/terraform/environments/sandbox/backend.hcl
```

Set `bucket` in `backend.hcl`, then initialize the sandbox backend:

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox init \
  -backend-config=backend.hcl
```

### Run The Scripted Deploy

```bash
AWS_PROFILE=expenseflow-smoke \
  AUTO_APPROVE=true \
  scripts/aws/e2e/deploy-demo.sh
```

Useful environment variables:

| Variable | Default | Use |
| --- | --- | --- |
| `IMAGE_TAG` | `demo-<UTC timestamp>` | Tag for all pushed images. |
| `AUTO_APPROVE` | `false` | Set `true` to pass `-auto-approve` to Terraform applies. |
| `SKIP_SPA_DEPLOY` | `false` | Set `true` when only backend infrastructure/images need redeploying. |
| `SKIP_BASTION_SEED` | `false` | Set `true` to skip migration and seed commands. |
| `SKIP_ZAP_SCAN` | `false` | Set `true` to skip the ZAP API scan step. |
| `VITE_TENANT_ID` | Primary synthetic tenant ID | Tenant baked into the SPA build. |
| `ROLE_PERMISSIONS_BOUNDARY_ARN` | Sandbox boundary ARN | Override if the account boundary ARN changes. |
| `RUN_READONLY_ROLE_STEP` | `false` | Set `true` to have the script open its own bastion SSM tunnel and apply GL-coding's readonly role and the `vector` extension - see "Finish The GL-Coding Readonly Role" below. Requires `session-manager-plugin` and `nc`, and AWS credentials with `ssm:StartSession` on the bastion. |
| `READONLY_ROLE_STEP_LOCAL_PORT` | `15432` | Local port for `RUN_READONLY_ROLE_STEP=true`'s SSM tunnel. Change only if `15432` is already in use locally. |
| `ZAP_IMAGE` | Pinned `ghcr.io/zaproxy/zaproxy` digest | Override the ZAP scan's container image, matching how `TRIVY_IMAGE`/`SYFT_IMAGE` are pinned in `secure-release-gate.yml`. |

The script passes required secrets, issuer URL, image URIs, and sandbox account
overrides to Terraform as `-var` arguments. You do not need to paste those into
`terraform.tfvars` for the scripted path, although keeping a complete tfvars is
useful for later manual plans.

### Finish The GL-Coding Readonly Role

One step is not automated by default. The GL-coding readonly database role
and the `vector` extension are managed through Terraform's `postgresql`
provider, which must reach the private RDS endpoint - only possible from
inside the VPC. Until this step has run at least once against a given
environment, GL-coding's ECS tasks cannot read their database credentials
and will not go healthy, and Core Case's pgvector-backed policy retrieval
will not work.

**Simplest: let the script do it.** Re-run `deploy-demo.sh` with
`RUN_READONLY_ROLE_STEP=true` - it opens its own SSM tunnel to the bastion,
fetches the RDS master password itself (directly via
`aws secretsmanager get-secret-value`, not `asm-exec` - this is not an
agent context, so the "keep secrets out of a model's context window" rule
that pattern exists for does not apply here), applies just the readonly-role
and extension resources, and tears the tunnel down when done, whether the
apply succeeds or fails:

```bash
AWS_PROFILE=expenseflow-smoke \
  RUN_READONLY_ROLE_STEP=true \
  AUTO_APPROVE=true \
  scripts/aws/e2e/deploy-demo.sh
```

This re-runs the full script (secrets, images, main apply, SPA, seed, ZAP
scan included) with the readonly-role step turned on. To apply only that
step against an already-deployed environment, add
`SKIP_SPA_DEPLOY=true SKIP_BASTION_SEED=true SKIP_ZAP_SCAN=true` to skip
the rest.

Requires the AWS Session Manager plugin, `nc`, and AWS credentials with
`ssm:StartSession` on the bastion.

**Manual fallback**, if you want to apply just that step by hand: `deploy-demo.sh`
prints the exact commands at the end of every run where
`RUN_READONLY_ROLE_STEP` was not `true`. They open the same SSM tunnel, then
run `terraform apply` with `PGUSER`/`PGPASSWORD` fetched the same
direct way (never printed, never in shell history) and
`postgresql_provider_host`/`postgresql_provider_port` pointed at the tunnel
as `-var` flags - `providers.tf` itself never needs editing. Do not read,
print, or paste the RDS master password anywhere outside that one
`PGPASSWORD=...` assignment. See `infra/terraform/modules/database/README.md`
for the underlying secret-safety rule.

## Spin Up Manually

**This is an alternative to "Spin Up With Scripts" above, not a follow-on to
it.** Use this path for troubleshooting or when you want to run each command
by hand instead of via `deploy-demo.sh`. Do not run both paths against the
same environment in the same session - pick one.

### 1. Create Remote State

Skip this if bootstrap already exists.

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/bootstrap init

AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/bootstrap apply
```

### 2. Configure The Backend

```bash
cp infra/terraform/environments/sandbox/backend.hcl.example \
  infra/terraform/environments/sandbox/backend.hcl
```

Edit `infra/terraform/environments/sandbox/backend.hcl` and set `bucket` to
the bootstrap `state_bucket_name` output.

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox init \
  -backend-config=backend.hcl
```

### 3. Generate Required Secrets

```bash
AWS_PROFILE=expenseflow-smoke \
  scripts/aws/generate-sandbox-secrets.sh
```

Paste the four printed secret ARNs into `terraform.tfvars`:

- `core_case_auth_jwt_private_key_secret_arn`
- `gl_coding_auth_jwt_public_keys_json_secret_arn`
- `core_case_mfa_totp_secret_encryption_key_secret_arn`
- `core_case_internal_command_token_secret_arn`

If you override `auth_jwt_key_id` in Terraform, run the secret generation
script with the same `AUTH_JWT_KEY_ID`.

### 4. Deploy The JWT Issuer

```bash
AWS_PROFILE=expenseflow-smoke \
  scripts/aws/package-jwt-issuer.sh

AWS_PROFILE=expenseflow-smoke \
  scripts/aws/deploy-jwt-issuer.sh
```

Paste the printed `IssuerUrl` into `terraform.tfvars` as
`http_api_jwt_issuer`.

`package-jwt-issuer.sh` also runs `npm --workspace platform/http-api run
build:lambda`, which produces the default HTTP API Lambda build outputs used by
Terraform.

### 5. Complete Sandbox Account Values

Set the sandbox account overrides in `terraform.tfvars`:

```hcl
allow_plain_http_public_api       = true
enable_nat_gateway                = false
db_enable_enhanced_monitoring     = false
core_case_internal_routes_enabled = true
role_permissions_boundary_arn     = "arn:aws:iam::ACCOUNT_ID:policy/TraineeSandboxBoundary"
http_api_lambda_vpc_id            = "vpc-xxxxxxxx"
```

Do not set image URI variables yet if this is a cold account and the ECR
repositories are not created.

### 6. Create ECR Repositories

Terraform needs the ECR repositories before images can be pushed. Run the
targeted apply after `terraform.tfvars` contains the required secret and issuer
values:

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox apply \
  -target=module.ecs.aws_ecr_repository.core_case \
  -target=module.ecs.aws_ecr_repository.gl_coding \
  -target=module.lambda_stage_transition_consumer.aws_ecr_repository.this
```

### 7. Build And Push Images

Choose one image tag and reuse it for every image:

```bash
export IMAGE_TAG="demo-$(date -u +%Y%m%dt%H%M%Sz)"
```

Build and push Core Case and GL-coding with the secure image script:

```bash
AWS_PROFILE=expenseflow-smoke \
AWS_REGION=us-east-1 \
CORE_CASE_REPOSITORY=expenseflow-sandbox-core-case-service \
GL_CODING_REPOSITORY=expenseflow-sandbox-gl-coding-service \
IMAGE_TAG="$IMAGE_TAG" \
scripts/aws/build-push-images.sh
```

This requires Trivy, Syft, Cosign, and a configured Cosign signing method. Do
not paste signing secrets into shell history or documentation.

Build and push the stage-transition consumer Lambda image:

```bash
AWS_PROFILE=expenseflow-smoke \
AWS_REGION=us-east-1 \
LAMBDA_REPOSITORY=expenseflow-sandbox-stage-transition-consumer-lambda \
IMAGE_TAG="$IMAGE_TAG" \
scripts/aws/SCRUM-149/package-stage-transition-lambda.sh
```

Resolve the account ID and paste the resulting image URIs into
`terraform.tfvars`:

```bash
AWS_PROFILE=expenseflow-smoke AWS_REGION=us-east-1 \
  aws sts get-caller-identity \
  --query Account \
  --output text
```

### 8. Apply The Full Sandbox

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox plan \
  -var-file=terraform.tfvars

AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox apply \
  -var-file=terraform.tfvars
```

This apply always skips GL-coding's readonly database role and the `vector`
extension - `db_readonly_roles_and_extensions_enabled` defaults to `false`
because both need the `postgresql` provider to reach RDS directly, which is
only possible from inside the VPC. Complete that step separately as
described in "Finish The GL-Coding Readonly Role" above once the rest of the
infrastructure is up - GL-coding's ECS tasks and Core Case's pgvector-backed
policy retrieval will not work correctly until it has run.

### 9. Run Migrations And Seed Data

The bastion helper resolves the needed Terraform outputs, MFA secret ARN, Core
Case repository URL, running image tag, and receipt bucket automatically:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh migrate
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh seed
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh demo-seed
```

### 10. Build And Deploy The SPA

The SPA must be built with the tenant ID. Leave `VITE_API_BASE_URL` empty so
the browser uses relative `/v1/*` calls through CloudFront.

```bash
VITE_API_BASE_URL="" \
VITE_TENANT_ID="8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb" \
  npm --workspace frontend/app run build
```

Deploy the build and invalidate CloudFront:

```bash
export SPA_BUCKET="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw spa_bucket_name)"
export SPA_DOMAIN="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw spa_cloudfront_domain_name)"
export SPA_DISTRIBUTION_ID="$(AWS_PROFILE=expenseflow-smoke aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='$SPA_DOMAIN'].Id | [0]" --output text)"

AWS_PROFILE=expenseflow-smoke aws s3 sync frontend/app/dist "s3://$SPA_BUCKET" \
  --delete --cache-control 'public,max-age=3600'

AWS_PROFILE=expenseflow-smoke aws s3 cp frontend/app/dist/index.html \
  "s3://$SPA_BUCKET/index.html" \
  --cache-control 'no-cache,no-store,must-revalidate' \
  --content-type 'text/html'

AWS_PROFILE=expenseflow-smoke aws cloudfront create-invalidation \
  --distribution-id "$SPA_DISTRIBUTION_ID" \
  --paths '/*'
```

### 11. Final Outputs

```bash
AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output public_alb_dns_name

AWS_PROFILE=expenseflow-smoke \
  terraform -chdir=infra/terraform/environments/sandbox output spa_cloudfront_domain_name
```

## Bastion Operations

**Reference material, not a spin-up step.** `deploy-demo.sh` already runs
`migrate`, `seed`, and `demo-seed` for you (see "Spin Up With Scripts"
above) - only come here to re-run one of them individually, or to generate
a sign-in TOTP code (see "Sign In And Validate" above). All commands in this
section use `scripts/aws/bastion-run.sh` over SSM Session Manager. They do
not require SSH.

By default, the script resolves common sandbox values from Terraform outputs,
the fixed MFA Secrets Manager secret name, and the running Core Case ECS task
definition. Run it from the repository root after the sandbox has been applied:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh code employee
```

Override the auto-resolved values only when troubleshooting or targeting a
non-default sandbox:

```bash
export BASTION_INSTANCE_ID="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw bastion_instance_id)"
export CORE_CASE_DB_MASTER_USER_SECRET_ARN="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_db_master_user_secret_arn)"
export CORE_CASE_DB_HOST="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_db_endpoint | cut -d: -f1)"
export CORE_CASE_DB_NAME="core_case"
export MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="<same ARN used for core_case_mfa_totp_secret_encryption_key_secret_arn>"
export CORE_CASE_IMAGE_URI="$(AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_repository_url)"
export CORE_CASE_IMAGE_TAG="<the image tag currently deployed>"
```

Run pending migrations:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh migrate
```

Seed the fixed synthetic sign-in accounts:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh seed
```

Seed demo expense data and synthetic receipts:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh demo-seed
```

Generate a TOTP code for sign-in:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/bastion-run.sh code employee
```

Valid aliases are `employee`, `manager`, `finance-admin`, and
`platform-admin`. Full account names such as `employee-1` and
`finance-admin-2` also work. TOTP codes rotate every 30 seconds.

## Known Constraints And Troubleshooting

**Background/reference, not a sequential step.** `deploy-demo.sh` already
passes every value below as a `-var` flag - nothing here needs to be set by
hand on the scripted path. Read this section when something fails and you
need to understand why, or when following "Spin Up Manually" and assembling
`terraform.tfvars` yourself.

### No ACM Certificate In The Sandbox Account

The public ALB has no HTTPS listener unless `public_alb_certificate_arn` is
configured. In the current sandbox, set:

```hcl
allow_plain_http_public_api = true
```

The browser still talks HTTPS to CloudFront. CloudFront proxies `/v1/*` to the
ALB as a server-to-server HTTP origin.

### NAT Gateway Creation Is Denied

The sandbox account denies `ec2:CreateNatGateway`, so set:

```hcl
enable_nat_gateway = false
```

Private AWS API access is handled by VPC endpoints in
`infra/terraform/environments/sandbox/endpoints.tf`.

### IAM Permissions Boundary Is Required

The sandbox account requires the Trainee sandbox permissions boundary on IAM
roles. Set:

```hcl
role_permissions_boundary_arn = "arn:aws:iam::ACCOUNT_ID:policy/TraineeSandboxBoundary"
```

### RDS Enhanced Monitoring Is Denied

The sandbox account does not allow passing a role to
`monitoring.rds.amazonaws.com`. Set:

```hcl
db_enable_enhanced_monitoring = false
```

### GL-Coding Readonly Role Requires Private RDS Access

The `database` module provisions a least-privilege Postgres role for
GL-coding, and separately creates the `vector` extension Core Case's policy
retrieval needs, both through Terraform's `cyrilgdn/postgresql` provider -
which must reach the private RDS endpoint directly, only possible from
inside the VPC. `db_readonly_roles_and_extensions_enabled` defaults to
`false` so a routine apply from outside the VPC skips these resources
instead of failing on a connection timeout. See "Finish The GL-Coding
Readonly Role" above for how to complete this step, and
`infra/terraform/modules/database/README.md` for the secret-safety rule
around the RDS master password it needs.

### `latest` Images Are Not Used

The deployment flow uses timestamped image tags. If bastion commands pull
`latest`, they will fail because `latest` is not pushed by this workflow. The
bastion helper resolves the running Core Case image tag from ECS by default.
Set `CORE_CASE_IMAGE_TAG` manually only if that lookup fails.

To inspect the current Core Case task image:

```bash
AWS_PROFILE=expenseflow-smoke AWS_REGION=us-east-1 \
  aws ecs describe-task-definition \
  --task-definition expenseflow-sandbox-core-case-service \
  --query 'taskDefinition.containerDefinitions[0].image' \
  --output text
```
