provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# Used by the database module to provision least-privilege application roles
# on the Core Case RDS instance (see modules/database/roles.tf).
#
# Per this repo's AWS Secret Safety rule (AGENTS.md), the RDS master
# credential is never read into Terraform config or state. This provider
# takes no username/password here - authenticate by exporting
# PGUSER/PGPASSWORD (resolved via `asm-exec` from master_user_secret_arn,
# never printed or logged) in the shell that runs `terraform apply`. Applying
# also requires network reachability to the private Core Case RDS instance -
# run apply from somewhere with VPC access (e.g. a bastion or VPN).
provider "postgresql" {
  host             = module.database_core_case.db_address
  port             = module.database_core_case.db_port
  database         = module.database_core_case.db_name
  sslmode          = "require"
  superuser        = false
  connect_timeout  = 15
  expected_version = "16.4"
}
