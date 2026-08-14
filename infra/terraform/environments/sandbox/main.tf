data "aws_caller_identity" "current" {}

locals {
  uses_existing_network = var.network_mode == "existing"

  tags = {
    user = "DonovanRodgers"
    env  = "sandbox"
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
}

module "network" {
  count = local.uses_existing_network ? 0 : 1

  source = "../../modules/network"

  availability_zone_count = var.availability_zone_count
  enable_nat_gateway      = var.enable_nat_gateway
  name_prefix             = var.name_prefix
  vpc_cidr                = var.vpc_cidr
}

module "alb" {
  source = "../../modules/alb"

  allow_plain_http_public_api = var.allow_plain_http_public_api
  internal_subnet_ids         = local.private_subnet_ids
  name_prefix                 = var.name_prefix
  public_alb_certificate_arn  = var.public_alb_certificate_arn
  public_subnet_ids           = local.public_subnet_ids
  runtime_smoke_source_cidrs  = var.runtime_smoke_source_cidrs
  vpc_id                      = local.vpc_id
}

module "ecs" {
  source = "../../modules/ecs"

  assign_public_ip                                    = false
  auth_jwt_key_id                                     = var.auth_jwt_key_id
  aws_region                                          = var.aws_region
  core_case_auth_jwt_private_key_secret_arn           = var.core_case_auth_jwt_private_key_secret_arn
  core_case_database_url_secret_arn                   = var.core_case_database_url_secret_arn
  core_case_image_uri                                 = var.core_case_image_uri
  core_case_internal_routes_enabled                   = var.core_case_internal_routes_enabled
  core_case_mfa_totp_secret_encryption_key_secret_arn = var.core_case_mfa_totp_secret_encryption_key_secret_arn
  core_case_runtime_smoke_shared_secret_arn           = var.core_case_runtime_smoke_shared_secret_arn
  core_case_target_group_arn                          = module.alb.core_case_target_group_arn
  core_case_tin_ein_validation_password_secret_arn    = var.core_case_tin_ein_validation_password_secret_arn
  core_case_tin_ein_validation_username_secret_arn    = var.core_case_tin_ein_validation_username_secret_arn
  desired_count                                       = var.desired_count
  dynamodb_expense_report_table_name                  = local.dynamodb_expense_report_table_name
  dynamodb_expense_report_tenant_index_name           = "${var.name_prefix}-expense-report-tenant-index"
  gl_coding_auth_jwt_public_keys_json_secret_arn      = var.gl_coding_auth_jwt_public_keys_json_secret_arn
  gl_coding_database_url_secret_arn                   = var.gl_coding_database_url_secret_arn
  gl_coding_image_uri                                 = var.gl_coding_image_uri
  gl_coding_target_group_arn                          = module.alb.gl_coding_target_group_arn
  internal_alb_dns_name                               = module.alb.internal_alb_dns_name
  internal_alb_security_group_id                      = module.alb.internal_alb_security_group_id
  mfa_totp_secret_key_version                         = var.mfa_totp_secret_key_version
  name_prefix                                         = var.name_prefix
  public_alb_security_group_id                        = module.alb.public_alb_security_group_id
  receipt_storage_bucket_name                         = local.receipt_storage_bucket_name
  redis_url                                           = var.redis_url
  role_permissions_boundary_arn                       = var.role_permissions_boundary_arn
  runtime_smoke_gl_coding_enabled                     = var.runtime_smoke_gl_coding_enabled
  service_subnet_ids                                  = local.private_subnet_ids
  tin_ein_validation_endpoint_url                     = var.tin_ein_validation_endpoint_url
  tin_ein_validation_wsdl_url                         = var.tin_ein_validation_wsdl_url
  vpc_id                                              = local.vpc_id
}

module "spa" {
  source = "../../modules/spa"

  bucket_name = local.spa_bucket_name
  name_prefix = var.name_prefix
}
