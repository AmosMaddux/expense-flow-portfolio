# Database

This module provisions a private-subnet RDS PostgreSQL instance for a single
service, with storage encryption, automated backups, and RDS-managed master
credentials. Each service that needs its own database calls this module
separately — see Core Case's usage in `environments/sandbox/main.tf` for an
example.

## Master credentials

The instance uses `manage_master_user_password = true`, so RDS creates and
owns the master password in Secrets Manager. No password value is set in this
module and none appears in Terraform state. The rule this repository's AWS
Secret Safety policy actually enforces is: the plaintext password must never
be printed, logged, or otherwise land somewhere with a longer lifetime or
wider audience than the one process that needs it - not that
`secretsmanager get-secret-value` itself is forbidden. Two approved ways to
get it into `PGPASSWORD`:

- **In an AI agent context** (an agent's own shell, or any process an
  agent's context could observe), resolve it via `asm-exec` with a dynamic
  reference, so the plaintext never enters the agent's context window at
  all:

  ```
  {{resolve:secretsmanager:<master_user_secret_arn>:SecretString:password}}
  ```

- **In a plain human/CI shell with no agent involved** (e.g.
  `scripts/aws/e2e/deploy-demo.sh`'s `RUN_READONLY_ROLE_STEP=true` path -
  see `infra/terraform/README.md`), fetch it directly with
  `aws secretsmanager get-secret-value ... | jq -r .password` into a shell
  variable that is exported to the one `terraform apply` process that needs
  it and never echoed, printed, or captured in shell history. `asm-exec` is
  an Agent Toolkit for AWS component and is not something every environment
  has installed; this direct fetch is the pattern to use where it isn't
  present.

Never call `secretsmanager get-secret-value` (or `batch-get-secret-value`)
and then print, echo, or log the result — that is what actually violates the
Secret Safety rule.

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

Each read-only role secret is encrypted with a customer-managed KMS key
(`aws_kms_key.readonly_role_secrets`, alias
`alias/<name_prefix>-<service_name>-db-readonly`) rather than the AWS-managed
default, with key rotation enabled and a key policy granting use only to the
account root and the Secrets Manager service. Automatic secret rotation is not
enabled: rotating these credentials needs a rotation Lambda that can re-apply
the Postgres role password, which is tracked as a follow-up and recorded as a
scoped `CKV2_AWS_57` suppression on the secret.

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
instance directly (see `environments/sandbox/providers.tf`'s
`postgresql_provider_host`/`postgresql_provider_port` override variables).
Applying changes under `readonly_roles` therefore needs network reachability
to the private RDS instance and master-user credentials supplied out-of-band
via `PGUSER`/`PGPASSWORD` in the apply shell — see "Master credentials"
above for the two approved ways to resolve them, never read into Terraform
config or state. See the AWS Secret Safety rule in `AGENTS.md`. Because of
this requirement, `readonly_roles_and_extensions_enabled` (see `variables.tf`)
defaults to `false` in every environment that calls this module — see
`infra/terraform/README.md`'s "Finish The GL-Coding Readonly Role" section
for the sandbox's specific workflow.

## Extensions

Set `extensions` to have the module create PostgreSQL extensions as the master
user. Application migrations run as the service user and cannot issue
`CREATE EXTENSION`, so any extension the schema depends on must be listed
here. Core Case passes `["vector"]` because policy retrieval stores chunk
embeddings in a pgvector column.

```hcl
extensions = ["vector"]
```

Like `readonly_roles`, this uses the `cyrilgdn/postgresql` provider and so
needs network reachability to the private RDS instance at apply time.

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
