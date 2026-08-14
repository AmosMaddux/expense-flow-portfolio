# Database

This module provisions a private-subnet RDS PostgreSQL instance for a single
service, with storage encryption, automated backups, and RDS-managed master
credentials. Each service that needs its own database calls this module
separately — see Core Case's usage in `environments/sandbox/main.tf` for an
example.

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

- No multi-database instances. Each module call provisions one RDS instance
  for one service; hosting multiple services' databases on a single instance
  is not supported.
- No application wiring. Consuming services' ECS task definitions don't
  automatically read from this module's outputs; connecting the two is a
  separate change per service.
- No data migration.

## Inputs

At minimum, callers must supply:

- `service_name` — short identifier used in resource names, e.g. `"core-case"`
  or `"gl-coding"`. Distinguishes one service's instance, subnet group, and
  security group from another's when the module is called more than once.
- `vpc_id`
- `private_subnet_ids` — used for the DB subnet group.
- `allowed_security_group_ids` — security groups (typically that service's ECS
  task SG) permitted to reach the database on port 5432. The database security
  group has no other ingress.

Sizing and operational settings (`instance_class`, `allocated_storage`,
`engine_version`, `backup_retention_period`, `multi_az`,
`deletion_protection`, `skip_final_snapshot`, `database_name`,
`master_username`) all have sandbox-safe defaults, with `database_name` and
`master_username` derived from `service_name` when left unset. See
`variables.tf`.

## Outputs

Consumers need two outputs to wire up a database connection:

- `db_endpoint` — host:port connection endpoint.
- `master_user_secret_arn` — Secrets Manager ARN of the RDS-managed secret.

`db_address`, `db_port`, and `security_group_id` are also available.
