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

variable "core_case_internal_target_group_arn" {
  description = "Target group ARN for Core Case on the internal ALB."
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
  default     = 365
}

variable "core_case_image_uri" {
  description = "Optional immutable image URI for Core Case."
  type        = string
  default     = null
}

variable "core_case_repository_url" {
  description = "Persistent ECR repository URL for Core Case images."
  type        = string
}

variable "core_case_repository_arn" {
  description = "Persistent ECR repository ARN for Core Case images."
  type        = string
}

variable "gl_coding_image_uri" {
  description = "Optional immutable image URI for GL-coding."
  type        = string
  default     = null
}

variable "gl_coding_repository_url" {
  description = "Persistent ECR repository URL for GL-coding images."
  type        = string
}

variable "auth_jwt_key_id" {
  description = "JWT key identifier used by the services."
  type        = string
  default     = "synthetic-sandbox-key"
}

variable "auth_jwt_issuer" {
  description = "Issuer claim Core Case signs into access tokens. Must match the HTTP API JWT authorizer's configured issuer (module.http_api's jwt_issuer) or every access token fails authorization."
  type        = string
}

variable "core_case_redis_url_secret_arn" {
  description = "Secrets Manager ARN of the assembled Redis connection URL (rediss://:token@host:port), consumed as REDIS_URL."
  type        = string
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

variable "core_case_enable_execute_command" {
  description = "Whether ECS Exec is enabled on the Core Case service, for interactive debugging via `aws ecs execute-command`. Leave off outside active debugging."
  type        = bool
  default     = false
}

variable "core_case_auto_apply_migrations" {
  description = "Whether Core Case applies pending Drizzle migrations on boot."
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

variable "spa_origin" {
  description = "HTTPS origin of the SPA (e.g. the CloudFront domain). Required by Core Case in production for credentialed CORS."
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

variable "stage_transition_sqs_max_receive_count" {
  description = "Number of failed receives before stage-transition messages move to the DLQ."
  type        = number
  default     = 3

  validation {
    condition     = var.stage_transition_sqs_max_receive_count >= 1 && var.stage_transition_sqs_max_receive_count <= 1000
    error_message = "stage_transition_sqs_max_receive_count must be between 1 and 1000."
  }
}

variable "core_case_auth_jwt_private_key_secret_arn" {
  description = "Secrets Manager ARN for Core Case JWT private key material."
  type        = string
  default     = null
}

variable "core_case_db_host" {
  description = "Hostname of the Core Case RDS instance."
  type        = string
}

variable "core_case_db_port" {
  description = "Port of the Core Case RDS instance."
  type        = number
}

variable "core_case_db_name" {
  description = "Database name on the Core Case RDS instance."
  type        = string
}

variable "core_case_db_master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret for the Core Case database."
  type        = string
}

variable "core_case_internal_command_token_secret_arn" {
  description = "Secrets Manager ARN for the shared internal command token. Core Case validates this against the x-core-case-internal-command-token header on internal routes; must be the same secret the Issue Payment Lambda (module.http_api) reads to send that header."
  type        = string
  default     = null
}

variable "core_case_mfa_totp_secret_encryption_key_secret_arn" {
  description = "Secrets Manager ARN for MFA TOTP encryption key."
  type        = string
  default     = null
}

variable "core_case_policy_assist_api_key_secret_arn" {
  description = "Secrets Manager ARN for the OpenAI API key used by Core Case policy assist. The secret must contain a POLICY_ASSIST_API_KEY JSON key."
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

variable "gl_coding_db_host" {
  description = "Hostname of the GL-coding RDS instance."
  type        = string
}

variable "gl_coding_db_port" {
  description = "Port of the GL-coding RDS instance."
  type        = number
}

variable "gl_coding_db_name" {
  description = "Database name on the GL-coding RDS instance."
  type        = string
}

variable "gl_coding_db_credentials_secret_arn" {
  description = "Secrets Manager ARN of GL-coding's scoped, least-privilege database credential (SELECT-only on its reference tables). Must not be the RDS master user secret."
  type        = string
}

variable "gl_coding_db_credentials_kms_key_arn" {
  description = "ARN of the customer-managed KMS key encrypting gl_coding_db_credentials_secret_arn (module.database's readonly_role_secrets_kms_key_arn output). The execution role needs kms:Decrypt on this key in addition to secretsmanager:GetSecretValue on the secret itself - Secrets Manager retrieving the record does not imply permission to decrypt it."
  type        = string
}

variable "gl_coding_internal_auth_secret_arn" {
  description = "Secrets Manager ARN for GL-coding internal authentication. Core Case reads this secret and includes X-Internal-Auth header in GL-coding requests. GL-coding service validates the header value."
  type        = string
  default     = null
}
