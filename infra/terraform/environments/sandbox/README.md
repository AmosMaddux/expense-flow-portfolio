# Sandbox Terraform

This root module provisions the first Terraform-managed ExpenseFlow sandbox
runtime:

- Existing sandbox VPC discovery by default, with optional managed VPC creation.
- Public ALB for Core Case routes.
- Internal ALB for GL-coding in private subnets.
- ECS Fargate cluster, task definitions, services, roles, log groups, and ECR repositories.
- Encrypted runtime data stores for receipts and Expense Report read projections.
- Private encrypted S3 bucket and CloudFront distribution for the SPA.

The backend uses the remote state resources created by `infra/terraform/bootstrap`.
Create a local `backend.hcl` from `backend.hcl.example` and fill in the real
state bucket name before initialization. Do not commit `backend.hcl`.

By default, this root discovers the existing sandbox VPC and its public/private
subnets by tags. The public ALB uses public subnets. The internal ALB and ECS
services use private subnets with public task IP assignment disabled. A NAT
gateway is created for private subnet egress unless `enable_nat_gateway=false`
is supplied.

Taggable resources receive `env=sandbox` and a `user` owner tag derived from
the AWS caller identity. Set `resource_owner` only when CI or a shared
credential needs an explicit owner override.

```bash
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox init -backend-config=backend.hcl
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox plan -var-file=terraform.tfvars
```

Secrets must be supplied as Secrets Manager ARNs only. Do not place secret
values in Terraform files, tfvars, logs, or plan output. The `redis_url` value is
required and must point to an ECS-reachable Redis endpoint provisioned outside
this module.

Plaintext public HTTP does not forward application traffic by default. Set
`allow_plain_http_public_api=true` only for a temporary sandbox test where
exposing `/v1` over HTTP is explicitly accepted. If no certificate is configured,
runtime smoke CIDR allowlists over HTTP also require
`allow_plain_http_public_api=true` so the intent is explicit at plan time.

## Required secrets and JWT issuer

Five Terraform variables have no default and must be supplied explicitly, or
`terraform apply` fails validation:

- `core_case_auth_jwt_private_key_secret_arn`
- `gl_coding_auth_jwt_public_keys_json_secret_arn`
- `core_case_mfa_totp_secret_encryption_key_secret_arn`
- `core_case_internal_command_token_secret_arn`
- `http_api_jwt_issuer`

Generate and publish the four Secrets Manager secrets (plus, optionally, the
runtime-smoke shared secret) with:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/generate-sandbox-secrets.sh
```

This prints the resulting ARNs as ready-to-use `-var` flags. It also generates
one RSA-2048 keypair shared by the first two secrets (Core Case signs, GL-coding
validates) — `auth_jwt_key_id` in tfvars must match the `AUTH_JWT_KEY_ID` the
script ran with (default `synthetic-sandbox-key`).

`http_api_jwt_issuer` needs a real deployed endpoint, not a secret. Deploy
`platform/http-api/issuer-template.yaml`, which serves the OIDC discovery
document and JWKS backed by the GL-coding public-JWKS secret above:

```bash
AWS_PROFILE=expenseflow-smoke scripts/aws/package-jwt-issuer.sh
AWS_PROFILE=expenseflow-smoke scripts/aws/deploy-jwt-issuer.sh
```

`deploy-jwt-issuer.sh` prints the stack's `IssuerUrl` output — pass that as
`http_api_jwt_issuer`.
