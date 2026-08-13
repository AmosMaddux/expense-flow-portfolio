# Terraform Bootstrap

This stack creates the remote Terraform state data store for the sandbox environment.
Run it before applying any other Terraform.

```bash
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/bootstrap init
AWS_PROFILE=expenseflow-smoke terraform -chdir=infra/terraform/bootstrap apply
```

The stack creates an encrypted, versioned S3 bucket and an encrypted DynamoDB
table. The sandbox backend uses the S3 bucket with Terraform's native S3 lockfile
support. Both resources receive the required sandbox tags:

- `user=muhilramesh`
- `env=sandbox`
