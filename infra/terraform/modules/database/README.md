# Database

This module provisions a private-subnet RDS PostgreSQL instance for the Core
Case Service, with storage encryption, automated backups, and RDS-managed
master credentials.

## Master credentials

The instance uses `manage_master_user_password = true`, so RDS creates and
owns the master password in Secrets Manager. No password value is set in this
module and none appears in Terraform state. Retrieve the credentials only
through the `master_user_secret_arn` output, never from state.

```bash
aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw master_user_secret_arn)" \
  --query SecretString --output text
```

The secret value is a JSON object (`username`, `password`, `dbname`, `host`,
`port`, etc.), not a `DATABASE_URL` connection string. Assembling a connection
string from it is application-level work, not something this module does.

## Out of scope

- No GL-coding database. This module provisions Core Case's database only.
- No application wiring. The Core Case ECS task definition does not yet read
  from this module's outputs; connecting the two is a separate change.
- No data migration.

## Inputs

At minimum, callers must supply:

- `vpc_id`
- `private_subnet_ids` — used for the DB subnet group.
- `allowed_security_group_ids` — security groups (typically the ECS task SG)
  permitted to reach the database on port 5432. The database security group
  has no other ingress.

Sizing and operational settings (`instance_class`, `allocated_storage`,
`engine_version`, `backup_retention_period`, `multi_az`,
`deletion_protection`, `skip_final_snapshot`, `database_name`,
`master_username`) all have sandbox-safe defaults. See `variables.tf`.

## Outputs

Consumers need two outputs to wire up a database connection:

- `db_endpoint` — host:port connection endpoint.
- `master_user_secret_arn` — Secrets Manager ARN of the RDS-managed secret.

`db_address`, `db_port`, and `security_group_id` are also available.
