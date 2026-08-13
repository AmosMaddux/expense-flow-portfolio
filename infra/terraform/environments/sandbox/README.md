# Sandbox Terraform

This root module provisions the first Terraform-managed ExpenseFlow sandbox
runtime:

- VPC with public and private subnets.
- Public ALB for Core Case routes.
- Internal ALB for GL-coding.
- ECS Fargate cluster, task definitions, services, roles, log groups, and ECR repositories.
- Encrypted runtime data stores for receipts and Expense Report read projections.
- Private encrypted S3 bucket and CloudFront distribution for the SPA.

The backend uses the remote state resources created by `infra/terraform/bootstrap`.

```bash
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox init
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/environments/sandbox plan
```

Secrets must be supplied as Secrets Manager ARNs only. Do not place secret values
in Terraform files, tfvars, logs, or plan output.
