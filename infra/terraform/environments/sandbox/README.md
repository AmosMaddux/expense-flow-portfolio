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
