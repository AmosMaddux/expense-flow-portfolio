# Database

This module provisions a private-subnet RDS PostgreSQL instance for a single
service, with storage encryption, automated backups, and RDS-managed master
credentials. Each service that needs its own database calls this module
separately — see Core Case's usage in `environments/sandbox/main.tf` for an
example.

## Master credentials

The instance uses `manage_master_user_password = true`, so RDS creates and
owns the master password in Secrets Manager. No password value is set in this
module and none appears in Terraform state. Never call `secretsmanager
get-secret-value` (or `batch-get-secret-value`) against `master_user_secret_arn`
— that prints the plaintext password to terminal output and potentially
captured logs, which this repository's AWS Secret Safety rule forbids.
Resolve it at runtime instead, via `asm-exec` with a dynamic reference:

```
{{resolve:secretsmanager:<master_user_secret_arn>:SecretString:password}}
```

The secret value is a JSON object (`username`, `password`, `dbname`, `host`,
`port`, etc.), not a `DATABASE_URL` connection string. Assembling a connection
string from it is application-level work, not something this module does.

Only a service that genuinely needs full read/write/DDL on the whole database
should ever receive `master_user_secret_arn`. A service that only needs
specific tables should get a `readonly_roles` credential instead (below) —
handing out the master secret to every consumer defeats the point of scoping
access at all.

## Least-privilege read-only roles

Set `readonly_roles` to have this module provision a SELECT-only Postgres
role per entry, scoped to exactly the tables listed, plus a Secrets Manager
secret holding its credential (same JSON shape as the master secret). Use
this for any consumer that only reads specific tables — e.g. GL-coding
reading Core Case's `gl_code`/`gl_mapping` reference tables — instead of
handing out `master_user_secret_arn`.

```hcl
readonly_roles = {
  gl_coding_app = {
    tables = ["gl_code", "gl_mapping"]
  }
}
```

Each role gets `SELECT` only — no `INSERT`/`UPDATE`/`DELETE`, no DDL, and no
access to any table not listed. The resulting secret ARN is available from
`readonly_role_secret_arns[<role name>]`.

This requires the `cyrilgdn/postgresql` provider, which connects to the
instance directly (see `environments/sandbox/providers.tf`). Applying changes
under `readonly_roles` therefore needs network reachability to the private
RDS instance and master-user credentials supplied out-of-band via
`PGUSER`/`PGPASSWORD` in the apply shell — resolved via `asm-exec`, never
read into Terraform config or state. See the AWS Secret Safety rule in
`AGENTS.md`.

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

`db_address`, `db_port`, and `security_group_id` are also available, along
with `readonly_role_secret_arns` (map keyed by `readonly_roles` role name)
for any least-privilege credentials provisioned above.
