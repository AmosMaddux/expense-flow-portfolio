# Terraform Bootstrap

This stack creates the remote Terraform state data store for the sandbox environment.
Run it before applying any other Terraform.

```bash
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/bootstrap init
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/bootstrap apply
```

The stack creates an encrypted, versioned S3 bucket for remote Terraform state.
The sandbox backend uses Terraform's native S3 lockfile support. The bucket
receives the required sandbox tags:

- `user=DonovanRodgers`
- `env=sandbox`
