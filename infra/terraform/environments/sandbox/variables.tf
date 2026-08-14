variable "aws_profile" {
  description = "Optional AWS CLI profile for local Terraform runs. Leave null in CI."
  type        = string
  default     = null
}

variable "aws_region" {
  description = "AWS region for sandbox infrastructure."
  type        = string
  default     = "us-east-1"
}

variable "resource_owner" {
  description = "Optional owner tag override. When null, Terraform derives the owner from the AWS caller identity."
  type        = string
  default     = null

  validation {
    condition     = var.resource_owner == null ? true : trimspace(var.resource_owner) != ""
    error_message = "resource_owner must be null or a non-empty string."
  }
}

variable "name_prefix" {
  description = "Prefix used for sandbox infrastructure names."
  type        = string
  default     = "expenseflow-sandbox"
}

variable "network_mode" {
  description = "Whether sandbox uses discovered existing networking or creates managed networking."
  type        = string
  default     = "existing"

  validation {
    condition     = contains(["existing", "managed"], var.network_mode)
    error_message = "network_mode must be either existing or managed."
  }
}

variable "existing_vpc_id" {
  description = "Optional existing sandbox VPC ID. If omitted, Terraform discovers the VPC by tags."
  type        = string
  default     = null
}

variable "existing_vpc_name" {
  description = "Name tag for the existing sandbox VPC when existing_vpc_id is not supplied."
  type        = string
  default     = "project-vpc"
}

variable "existing_public_subnet_ids" {
  description = "Optional existing public subnet IDs. If omitted, Terraform discovers them by tag patterns."
  type        = list(string)
  default     = []
}

variable "existing_private_subnet_ids" {
  description = "Optional existing private subnet IDs. If omitted, Terraform discovers them by tag patterns."
  type        = list(string)
  default     = []
}

variable "existing_private_route_table_ids" {
  description = "Optional existing private route table IDs that Terraform may manage NAT routes for. Omitting or leaving empty enables automatic discovery of private route tables explicitly associated with private subnets."
  type        = list(string)
  default     = []
}

variable "existing_public_subnet_name_patterns" {
  description = "Name tag patterns used to discover public subnets in the existing sandbox VPC."
  type        = list(string)
  default     = ["project-subnet-public*"]
}

variable "existing_private_subnet_name_patterns" {
  description = "Name tag patterns used to discover private subnets in the existing sandbox VPC."
  type        = list(string)
  default     = ["project-subnet-private*"]
}

variable "vpc_cidr" {
  description = "CIDR block for the Terraform-managed sandbox VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of availability zones used for VPC subnets."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "availability_zone_count must be between 2 and 3."
  }
}

variable "enable_nat_gateway" {
  description = "Whether to create a NAT gateway for private ECS task egress."
  type        = bool
  default     = true
}

variable "allow_plain_http_public_api" {
  description = "Whether to expose /v1 over plaintext HTTP when no ACM certificate is configured."
  type        = bool
  default     = false
}

variable "public_alb_certificate_arn" {
  description = "Optional ACM certificate ARN for public ALB HTTPS."
  type        = string
  default     = null
}

variable "runtime_smoke_source_cidrs" {
  description = "Optional CIDRs allowed to reach runtime smoke routes."
  type        = list(string)
  default     = []
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN required by the sandbox account."
  type        = string
  default     = null
}

variable "desired_count" {
  description = "Desired task count for each ECS service."
  type        = number
  default     = 1
}

variable "core_case_image_uri" {
  description = "Optional immutable Core Case image URI."
  type        = string
  default     = null
}

variable "gl_coding_image_uri" {
  description = "Optional immutable GL-coding image URI."
  type        = string
  default     = null
}

variable "auth_jwt_key_id" {
  description = "JWT key identifier used by the services."
  type        = string
  default     = "synthetic-sandbox-key"
}

variable "redis_url" {
  description = "ECS-reachable Redis URL. Terraform does not create Redis in this module."
  type        = string
  nullable    = false

  validation {
    # Keep this validation aligned with ../../modules/ecs/variables.tf.
    condition     = can(regex("^rediss?://([^/@]+@)?[A-Za-z0-9.-]*[A-Za-z][A-Za-z0-9.-]*(?::[0-9]+)?(?:/.*)?$", var.redis_url)) && !can(regex("(?i)^rediss?://([^/@]+@)?localhost(?::|/|$)", var.redis_url))
    error_message = "redis_url must be an ECS-reachable redis:// or rediss:// hostname URL, not localhost, loopback, bind-all, or an IP literal."
  }
}

variable "mfa_totp_secret_key_version" {
  description = "Version label for the MFA TOTP secret encryption key."
  type        = string
  default     = "v1"
}

variable "core_case_internal_routes_enabled" {
  description = "Whether internal Core Case routes are enabled."
  type        = bool
  default     = false
}

variable "runtime_smoke_gl_coding_enabled" {
  description = "Whether Core Case exposes the GL-coding runtime smoke route."
  type        = bool
  default     = false
}

variable "tin_ein_validation_endpoint_url" {
  description = "TIN/EIN validation endpoint URL."
  type        = string
  default     = "https://tin-ein-validation.example.test"
}

variable "tin_ein_validation_wsdl_url" {
  description = "TIN/EIN validation WSDL URL."
  type        = string
  default     = "https://tin-ein-validation.example.test/service.wsdl"
}

variable "core_case_auth_jwt_private_key_secret_arn" {
  description = "Secrets Manager ARN for Core Case JWT private key material."
  type        = string
  default     = null
}

variable "core_case_database_url_secret_arn" {
  description = "Secrets Manager ARN for Core Case database URL."
  type        = string
  default     = null
}

variable "core_case_mfa_totp_secret_encryption_key_secret_arn" {
  description = "Secrets Manager ARN for MFA TOTP encryption key."
  type        = string
  default     = null
}

variable "core_case_runtime_smoke_shared_secret_arn" {
  description = "Secrets Manager ARN for runtime smoke shared secret."
  type        = string
  default     = null
}

variable "core_case_tin_ein_validation_password_secret_arn" {
  description = "Secrets Manager ARN for TIN/EIN validation password."
  type        = string
  default     = null
}

variable "core_case_tin_ein_validation_username_secret_arn" {
  description = "Secrets Manager ARN for TIN/EIN validation username."
  type        = string
  default     = null
}

variable "gl_coding_auth_jwt_public_keys_json_secret_arn" {
  description = "Secrets Manager ARN for GL-coding JWT public keys JSON."
  type        = string
  default     = null
}

variable "gl_coding_database_url_secret_arn" {
  description = "Secrets Manager ARN for GL-coding database URL."
  type        = string
  default     = null
}
