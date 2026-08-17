variable "name_prefix" {
  description = "Name prefix for ECS resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable ECS resources."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region for ECS runtime configuration."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for ECS task security groups."
  type        = string
}

variable "service_subnet_ids" {
  description = "Subnet IDs for Fargate service placement."
  type        = list(string)

  validation {
    condition     = length(var.service_subnet_ids) > 0
    error_message = "service_subnet_ids must include at least one private subnet."
  }
}

variable "assign_public_ip" {
  description = "Whether Fargate tasks receive public IP addresses."
  type        = bool
  default     = false

  validation {
    condition     = var.assign_public_ip == false
    error_message = "Fargate services must not receive public IP addresses."
  }
}

variable "public_alb_security_group_id" {
  description = "Security group ID for the public ALB."
  type        = string
}

variable "internal_alb_security_group_id" {
  description = "Security group ID for the internal ALB."
  type        = string
}

variable "core_case_target_group_arn" {
  description = "Target group ARN for Core Case."
  type        = string
}

variable "gl_coding_target_group_arn" {
  description = "Target group ARN for GL-coding."
  type        = string
}

variable "internal_alb_dns_name" {
  description = "DNS name for the internal GL-coding ALB."
  type        = string
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN for ECS roles."
  type        = string
  default     = null
}

variable "desired_count" {
  description = "Desired task count for each ECS service."
  type        = number
  default     = 1
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 14
}

variable "core_case_image_uri" {
  description = "Optional immutable image URI for Core Case."
  type        = string
  default     = null
}

variable "gl_coding_image_uri" {
  description = "Optional immutable image URI for GL-coding."
  type        = string
  default     = null
}

variable "auth_jwt_key_id" {
  description = "JWT key identifier used by the services."
  type        = string
  default     = "synthetic-sandbox-key"
}

variable "redis_url" {
  description = "ECS-reachable Redis URL."
  type        = string
  nullable    = false

  validation {
    # Keep this validation aligned with ../../environments/sandbox/variables.tf.
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

variable "receipt_storage_bucket_name" {
  description = "Name for the encrypted receipt storage bucket."
  type        = string
}

variable "dynamodb_expense_report_table_name" {
  description = "Name for the Expense Report read-projection DynamoDB table."
  type        = string
}

variable "dynamodb_expense_report_tenant_index_name" {
  description = "Tenant index name passed to Core Case."
  type        = string
  default     = "expenseflow-sandbox-expense-report-tenant-index"
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

variable "gl_coding_internal_auth_secret_arn" {
  description = "Secrets Manager ARN for GL-coding internal authentication. Core Case reads this secret and includes X-Internal-Auth header in GL-coding requests. GL-coding service validates the header value."
  type        = string
  default     = null
}
