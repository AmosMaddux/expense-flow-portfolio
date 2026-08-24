variable "name_prefix" {
  description = "Name prefix for HTTP API resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable HTTP API resources."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region for Lambda runtime configuration."
  type        = string
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN for the HTTP API Lambda execution roles."
  type        = string
  default     = null
}

variable "stage_name" {
  description = "HTTP API stage name."
  type        = string
  default     = "v1"
}

variable "jwt_issuer" {
  description = "HTTPS issuer URL that publishes OIDC metadata and the shared JWKS for the JWT authorizer."
  type        = string

  validation {
    condition     = can(regex("^https://.+", var.jwt_issuer))
    error_message = "jwt_issuer must be an https:// URL."
  }
}

variable "jwt_audience" {
  description = "Expected audience claim for the shared JWT authorizer."
  type        = string
  default     = "expenseflow-http-api"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days for the HTTP API Lambda functions."
  type        = number
  default     = 365
}

# Claims-probe function (proves the JWT authorizer forwards verified claims).

variable "claims_probe_build_output" {
  description = "Path to the built claims-probe Lambda bundle (esbuild output, e.g. platform/http-api/build/claimsProbe.js)."
  type        = string
}

# Issue Payment function (the API Gateway payment path).

variable "issue_payment_build_output" {
  description = "Path to the built Issue Payment Lambda bundle (esbuild output, e.g. platform/http-api/build/issuePaymentStub.js)."
  type        = string
}

variable "core_case_internal_base_url" {
  description = "Base URL the Issue Payment Lambda uses to call Core Case's internal settlement route. Must point to a private Core Case endpoint (internal ALB, Cloud Map, or Service Connect hostname)."
  type        = string

  validation {
    condition     = can(regex("^https?://.+", var.core_case_internal_base_url))
    error_message = "core_case_internal_base_url must be an http:// or https:// URL."
  }
}

variable "core_case_internal_command_token_secret_arn" {
  description = "Secrets Manager secret ARN containing the shared internal command token accepted by Core Case."
  type        = string
}

variable "core_case_internal_timeout_ms" {
  description = "Timeout, in milliseconds, for the Issue Payment Lambda's call into Core Case."
  type        = number
  default     = 5000

  validation {
    condition     = var.core_case_internal_timeout_ms >= 1 && var.core_case_internal_timeout_ms <= 30000
    error_message = "core_case_internal_timeout_ms must be between 1 and 30000."
  }
}

variable "issue_payment_timeout_seconds" {
  description = "Issue Payment Lambda function timeout in seconds."
  type        = number
  default     = 5
}

variable "issue_payment_memory_size" {
  description = "Issue Payment Lambda function memory size in MB."
  type        = number
  default     = 128
}

variable "claims_probe_timeout_seconds" {
  description = "Claims-probe Lambda function timeout in seconds."
  type        = number
  default     = 5
}

variable "claims_probe_memory_size" {
  description = "Claims-probe Lambda function memory size in MB."
  type        = number
  default     = 128
}

variable "vpc_id" {
  description = "Optional VPC ID for the Issue Payment Lambda when it must run in the VPC to reach a private Core Case endpoint. Leave null to run outside the VPC."
  type        = string
  default     = null
}

variable "private_subnet_ids" {
  description = "Optional private subnet IDs for the Issue Payment Lambda when var.vpc_id is set."
  type        = list(string)
  default     = []
}
