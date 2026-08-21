# ExpenseFlow Sandbox Infrastructure

This is the operational entry point for the Terraform-managed ExpenseFlow
sandbox. Use it when you need to create the sandbox infrastructure, deploy the
application images, publish the SPA, seed demo data, and sign in.

Run commands from the repository root unless a step explicitly says otherwise.
The sandbox creates real AWS resources and may incur charges.

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
  scripts/aws/run-terraform-e2e-smoke.sh
```

That smoke test requires valid JWT inputs and other runtime values; read the
script README before running it.

## Prerequisites

Install and configure these before starting:

- AWS CLI authenticated to the `expenseflow-smoke` profile.
- Terraform `>= 1.6.0`.
- Docker with Buildx support.
- AWS SAM CLI, used by the JWT issuer packaging flow.
- Node.js `>= 24`.
- `jq`.
- OpenSSL.
- AWS Session Manager plugin, required for SSM port forwarding.
- `asm-exec`, required when Terraform's PostgreSQL provider needs the RDS
  master password resolved from Secrets Manager.
- Trivy, Syft, and Cosign when using the secure image build script.

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
5. Runs the full Terraform apply.
6. Builds and deploys the SPA to S3 and CloudFront.
7. Runs migrations, account seeding, and demo-data seeding through the bastion.

The script is idempotent and safe to re-run, but it deploys real, billed AWS
infrastructure. It does not tear the environment down.

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
| `VITE_TENANT_ID` | Primary synthetic tenant ID | Tenant baked into the SPA build. |
| `ROLE_PERMISSIONS_BOUNDARY_ARN` | Sandbox boundary ARN | Override if the account boundary ARN changes. |

The script passes required secrets, issuer URL, image URIs, and sandbox account
overrides to Terraform as `-var` arguments. You do not need to paste those into
`terraform.tfvars` for the scripted path, although keeping a complete tfvars is
useful for later manual plans.

### Finish The GL-Coding Readonly Role

One step is intentionally not automated. The GL-coding readonly database role
is managed through Terraform's `postgresql` provider, which must reach the
private RDS endpoint. From a laptop, that requires an SSM tunnel through the
bastion after the first apply has created it.

Use the command printed at the end of `deploy-demo.sh` to open the tunnel.
Then run Terraform from an environment where `PGUSER` and `PGPASSWORD` are
provided through the approved `asm-exec` dynamic-reference pattern described in
`infra/terraform/modules/database/README.md`. Do not print or paste the RDS
master password into terminal output.

## Spin Up Manually

Use this path for troubleshooting or when you want to run each command by hand.

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

If the apply reaches the GL-coding readonly-role resources and cannot connect
to PostgreSQL, let the rest of the infrastructure finish, then complete the
readonly-role step through the bastion as described in
`Finish The GL-Coding Readonly Role`.

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

All commands in this section use `scripts/aws/bastion-run.sh` over SSM Session
Manager. They do not require SSH.

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
GL-coding. Terraform uses the `cyrilgdn/postgresql` provider for that role, so
the apply shell needs both:

- Network access to the private RDS endpoint, usually through the bastion SSM
  tunnel.
- `PGUSER` and `PGPASSWORD` supplied out of band using the approved
  `asm-exec` dynamic-reference pattern.

Do not read, print, or paste the RDS master password. See
`infra/terraform/modules/database/README.md` for the secret-safety rule and
the dynamic reference format.

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
