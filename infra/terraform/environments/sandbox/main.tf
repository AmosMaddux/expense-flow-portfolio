data "aws_caller_identity" "current" {}

locals {
  uses_existing_network = var.network_mode == "existing"

  # Keep this tag derivation aligned with ../../bootstrap/main.tf.
  caller_name = try(regex("(user|assumed-role)/([^/@]+)", data.aws_caller_identity.current.arn)[1], "unknown")

  tags = {
    env                       = "sandbox"
    tenant-isolation-boundary = "tenant-scoped"
    user                      = coalesce(var.resource_owner, local.caller_name)
  }

  account_id                         = data.aws_caller_identity.current.account_id
  spa_bucket_name                    = "${var.name_prefix}-spa-${local.account_id}-${var.aws_region}"
  receipt_storage_bucket_name        = "${var.name_prefix}-receipts-${local.account_id}-${var.aws_region}"
  dynamodb_expense_report_table_name = "${var.name_prefix}-expense-report"

  existing_vpc_id = local.uses_existing_network ? (
    var.existing_vpc_id == null ? data.aws_vpc.existing[0].id : var.existing_vpc_id
  ) : null
  existing_public_subnet_ids = local.uses_existing_network ? (
    length(var.existing_public_subnet_ids) == 0 ? data.aws_subnets.existing_public[0].ids : var.existing_public_subnet_ids
  ) : []
  existing_private_subnet_ids = local.uses_existing_network ? (
    length(var.existing_private_subnet_ids) == 0 ? data.aws_subnets.existing_private[0].ids : var.existing_private_subnet_ids
  ) : []

  vpc_id             = local.uses_existing_network ? local.existing_vpc_id : module.network[0].vpc_id
  vpc_cidr           = local.uses_existing_network ? data.aws_vpc.selected[0].cidr_block : var.vpc_cidr
  public_subnet_ids  = local.uses_existing_network ? local.existing_public_subnet_ids : module.network[0].public_subnet_ids
  private_subnet_ids = local.uses_existing_network ? local.existing_private_subnet_ids : module.network[0].private_subnet_ids

  # Issue Payment Lambda's internal settlement calls to Core Case route over the internal ALB,
  # matching the /v1/internal/* rule on module.alb's internal listener. Reachable only when the
  # Lambda also runs inside the VPC (http_api_lambda_vpc_id set).
  core_case_internal_base_url = "http://${module.alb.internal_alb_dns_name}"
}

module "network" {
  count = local.uses_existing_network ? 0 : 1

  source = "../../modules/network"

  availability_zone_count = var.availability_zone_count
  enable_nat_gateway      = var.enable_nat_gateway
  name_prefix             = var.name_prefix
  tags                    = local.tags
  vpc_cidr                = var.vpc_cidr
}

module "alb" {
  source = "../../modules/alb"

  allow_plain_http_public_api        = var.allow_plain_http_public_api
  gl_coding_internal_auth_secret_arn = var.gl_coding_internal_auth_secret_arn
  internal_subnet_ids                = local.private_subnet_ids
  name_prefix                        = var.name_prefix
  public_alb_certificate_arn         = var.public_alb_certificate_arn
  public_subnet_ids                  = local.public_subnet_ids
  runtime_smoke_source_cidrs         = var.runtime_smoke_source_cidrs
  tags                               = local.tags
  vpc_id                             = local.vpc_id
}

resource "terraform_data" "public_alb_routing_configuration" {
  lifecycle {
    precondition {
      condition     = var.public_alb_certificate_arn != null || var.allow_plain_http_public_api
      error_message = "Sandbox public ALB must use HTTPS with public_alb_certificate_arn or temporary plaintext HTTP with allow_plain_http_public_api = true."
    }
  }
}

module "ecs" {
  source = "../../modules/ecs"

  assign_public_ip                                    = false
  auth_jwt_issuer                                     = var.http_api_jwt_issuer
  auth_jwt_key_id                                     = var.auth_jwt_key_id
  aws_region                                          = var.aws_region
  core_case_auth_jwt_private_key_secret_arn           = var.core_case_auth_jwt_private_key_secret_arn
  core_case_db_host                                   = module.database_core_case.db_address
  core_case_db_master_user_secret_arn                 = module.database_core_case.master_user_secret_arn
  core_case_db_name                                   = module.database_core_case.db_name
  core_case_db_port                                   = module.database_core_case.db_port
  core_case_image_uri                                 = var.core_case_image_uri
  core_case_repository_arn                            = var.core_case_repository_arn
  core_case_repository_url                            = var.core_case_repository_url
  core_case_internal_command_token_secret_arn         = var.core_case_internal_command_token_secret_arn
  core_case_internal_target_group_arn                 = module.alb.core_case_internal_target_group_arn
  core_case_internal_routes_enabled                   = var.core_case_internal_routes_enabled
  core_case_mfa_totp_secret_encryption_key_secret_arn = var.core_case_mfa_totp_secret_encryption_key_secret_arn
  core_case_runtime_smoke_shared_secret_arn           = var.core_case_runtime_smoke_shared_secret_arn
  core_case_redis_url_secret_arn                      = module.redis.redis_url_secret_arn
  core_case_target_group_arn                          = module.alb.core_case_target_group_arn
  core_case_tin_ein_validation_password_secret_arn    = var.core_case_tin_ein_validation_password_secret_arn
  core_case_tin_ein_validation_username_secret_arn    = var.core_case_tin_ein_validation_username_secret_arn
  desired_count                                       = var.desired_count
  dynamodb_expense_report_table_name                  = local.dynamodb_expense_report_table_name
  dynamodb_expense_report_tenant_index_name           = "${var.name_prefix}-expense-report-tenant-index"
  gl_coding_auth_jwt_public_keys_json_secret_arn      = var.gl_coding_auth_jwt_public_keys_json_secret_arn
  gl_coding_db_credentials_kms_key_arn                = module.database_core_case.readonly_role_secrets_kms_key_arn
  gl_coding_db_credentials_secret_arn                 = module.database_core_case.readonly_role_secret_arns["gl_coding_app"]
  gl_coding_db_host                                   = module.database_core_case.db_address
  gl_coding_db_name                                   = module.database_core_case.db_name
  gl_coding_db_port                                   = module.database_core_case.db_port
  gl_coding_image_uri                                 = var.gl_coding_image_uri
  gl_coding_internal_auth_secret_arn                  = var.gl_coding_internal_auth_secret_arn
  gl_coding_repository_url                            = var.gl_coding_repository_url
  gl_coding_target_group_arn                          = module.alb.gl_coding_target_group_arn
  internal_alb_dns_name                               = module.alb.internal_alb_dns_name
  internal_alb_security_group_id                      = module.alb.internal_alb_security_group_id
  mfa_totp_secret_key_version                         = var.mfa_totp_secret_key_version
  name_prefix                                         = var.name_prefix
  public_alb_security_group_id                        = module.alb.public_alb_security_group_id
  receipt_storage_bucket_name                         = local.receipt_storage_bucket_name
  role_permissions_boundary_arn                       = var.role_permissions_boundary_arn
  runtime_smoke_gl_coding_enabled                     = var.runtime_smoke_gl_coding_enabled
  service_subnet_ids                                  = local.private_subnet_ids
  spa_origin                                          = "https://${module.spa.cloudfront_domain_name}"
  tin_ein_validation_endpoint_url                     = var.tin_ein_validation_endpoint_url
  tin_ein_validation_wsdl_url                         = var.tin_ein_validation_wsdl_url
  tags                                                = local.tags
  vpc_id                                              = local.vpc_id
}

module "bastion" {
  source = "../../modules/bastion"

  core_case_repository_url                  = module.ecs.core_case_repository_url
  core_case_repository_url_arn              = module.ecs.core_case_repository_arn
  database_master_user_secret_arn           = module.database_core_case.master_user_secret_arn
  mfa_totp_secret_encryption_key_secret_arn = var.core_case_mfa_totp_secret_encryption_key_secret_arn
  name_prefix                               = var.name_prefix
  private_subnet_id                         = local.private_subnet_ids[0]
  receipt_storage_bucket_arn                = module.ecs.receipt_storage_bucket_arn
  role_permissions_boundary_arn             = var.role_permissions_boundary_arn
  tags                                      = local.tags
  vpc_id                                    = local.vpc_id
}

module "database_core_case" {
  source = "../../modules/database"

  allocated_storage = var.db_allocated_storage
  allowed_security_group_ids = [
    module.ecs.core_case_security_group_id,
    module.ecs.gl_coding_security_group_id,
    module.lambda_stage_transition_consumer.security_group_id,
  ]
  enable_enhanced_monitoring    = var.db_enable_enhanced_monitoring
  instance_class                = var.db_instance_class
  name_prefix                   = var.name_prefix
  private_subnet_ids            = local.private_subnet_ids
  role_permissions_boundary_arn = var.role_permissions_boundary_arn
  service_name                  = "core-case"
  tags                          = local.tags
  vpc_id                        = local.vpc_id

  # Policy retrieval stores tenant policy chunk embeddings in a pgvector
  # column, and the service user running migrations cannot create extensions.
  extensions                            = ["vector"]
  readonly_roles_and_extensions_enabled = var.db_readonly_roles_and_extensions_enabled

  readonly_roles = {
    gl_coding_app = {
      # GL-coding only ever reads GL reference data - see
      # backend/python/gl_mapping_repository.py. It must never get the RDS
      # master credential, which has full read/write/DDL on every table.
      tables = ["gl_code", "gl_mapping"]
    }
  }
}

# Declared here rather than inside either module to avoid a module cycle:
# bastion needs database_core_case's master secret ARN, and this rule needs
# both modules' security group IDs.
resource "aws_vpc_security_group_ingress_rule" "database_from_bastion" {
  security_group_id            = module.database_core_case.security_group_id
  description                  = "Allow PostgreSQL access from the sandbox bastion."
  referenced_security_group_id = module.bastion.security_group_id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

module "redis" {
  source = "../../modules/redis"

  allowed_security_group_ids = [
    module.ecs.core_case_security_group_id,
  ]
  name_prefix        = var.name_prefix
  private_subnet_ids = local.private_subnet_ids
  service_name       = "core-case"
  tags               = local.tags
  vpc_id             = local.vpc_id
}

module "lambda_stage_transition_consumer" {
  source = "../../modules/lambda-stage-transition-consumer"

  aws_region                          = var.aws_region
  core_case_db_host                   = module.database_core_case.db_address
  core_case_db_master_user_secret_arn = module.database_core_case.master_user_secret_arn
  core_case_db_name                   = module.database_core_case.db_name
  core_case_db_port                   = module.database_core_case.db_port
  image_uri                           = var.stage_transition_lambda_image_uri
  name_prefix                         = var.name_prefix
  private_subnet_ids                  = local.private_subnet_ids
  repository_url                      = var.stage_transition_lambda_repository_url
  role_permissions_boundary_arn       = var.role_permissions_boundary_arn
  stage_transition_sqs_dlq_arn        = module.ecs.stage_transition_sqs_dlq_arn
  stage_transition_sqs_queue_arn      = module.ecs.stage_transition_sqs_queue_arn
  tags                                = local.tags
  vpc_id                              = local.vpc_id
}

module "http_api" {
  source = "../../modules/http-api"

  aws_region                                  = var.aws_region
  claims_probe_build_output                   = var.http_api_claims_probe_build_output
  core_case_internal_base_url                 = local.core_case_internal_base_url
  core_case_internal_command_token_secret_arn = var.core_case_internal_command_token_secret_arn
  core_case_public_base_url                   = "http://${module.alb.public_alb_dns_name}"
  issue_payment_build_output                  = var.http_api_issue_payment_build_output
  jwt_audience                                = var.http_api_jwt_audience
  jwt_issuer                                  = var.http_api_jwt_issuer
  name_prefix                                 = var.name_prefix
  private_subnet_ids                          = var.http_api_lambda_vpc_id == null ? [] : local.private_subnet_ids
  role_permissions_boundary_arn               = var.role_permissions_boundary_arn
  tags                                        = local.tags
  vpc_id                                      = var.http_api_lambda_vpc_id
}

module "observability" {
  source = "../../modules/observability"

  aws_region                             = var.aws_region
  core_case_log_group_name               = module.ecs.core_case_log_group_name
  gl_coding_log_group_name               = module.ecs.gl_coding_log_group_name
  name_prefix                            = var.name_prefix
  stage_transition_lambda_log_group_name = module.lambda_stage_transition_consumer.log_group_name
  tags                                   = local.tags
}

# Declared here rather than inside either module to avoid a module cycle:
# the HTTP API Lambda needs the internal ALB DNS name, and this rule needs
# both the internal ALB and Lambda security group IDs.
resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_issue_payment_lambda" {
  #checkov:skip=CKV_AWS_260: Internal ALB port 80 ingress is scoped to the Issue Payment Lambda security group, not public CIDR, owner platform-security, review by 2026-12-31
  count = var.http_api_lambda_vpc_id == null ? 0 : 1

  security_group_id            = module.alb.internal_alb_security_group_id
  description                  = "Allow the VPC-attached Issue Payment Lambda to reach the Core Case internal settlement route."
  referenced_security_group_id = module.http_api.issue_payment_lambda_security_group_id
  from_port                    = 80
  ip_protocol                  = "tcp"
  to_port                      = 80
}

module "spa" {
  source = "../../modules/spa"

  bucket_name = local.spa_bucket_name
  name_prefix = var.name_prefix
  tags        = local.tags
}
