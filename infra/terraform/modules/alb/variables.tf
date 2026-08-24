variable "name_prefix" {
  description = "Name prefix for ALB resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable ALB resources."
  type        = map(string)
  default     = {}
}

variable "public_alb_name" {
  description = "Name for the public ALB. AWS requires 32 characters or fewer."
  type        = string
  default     = "ef-sbox-pub-alb"

  validation {
    condition     = length(var.public_alb_name) <= 32
    error_message = "public_alb_name must be 32 characters or fewer."
  }
}

variable "internal_alb_name" {
  description = "Name for the internal ALB. AWS requires 32 characters or fewer."
  type        = string
  default     = "ef-sbox-int-alb"

  validation {
    condition     = length(var.internal_alb_name) <= 32
    error_message = "internal_alb_name must be 32 characters or fewer."
  }
}

variable "core_case_target_group_name" {
  description = "Name for the Core Case target group. AWS requires 32 characters or fewer."
  type        = string
  default     = "ef-sbox-core-tg"

  validation {
    condition     = length(var.core_case_target_group_name) <= 32
    error_message = "core_case_target_group_name must be 32 characters or fewer."
  }
}

variable "gl_coding_target_group_name" {
  description = "Name for the GL-coding target group. AWS requires 32 characters or fewer."
  type        = string
  default     = "ef-sbox-gl-tg"

  validation {
    condition     = length(var.gl_coding_target_group_name) <= 32
    error_message = "gl_coding_target_group_name must be 32 characters or fewer."
  }
}

variable "core_case_internal_target_group_name" {
  description = "Name for the Core Case internal target group. AWS requires 32 characters or fewer."
  type        = string
  default     = "ef-sbox-core-int-tg"

  validation {
    condition     = length(var.core_case_internal_target_group_name) <= 32
    error_message = "core_case_internal_target_group_name must be 32 characters or fewer."
  }
}

variable "vpc_id" {
  description = "VPC ID for load balancers and target groups."
  type        = string
}

variable "public_subnet_ids" {
  description = "Subnets for the internet-facing ALB."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) > 0
    error_message = "public_subnet_ids must include at least one public subnet."
  }
}

variable "internal_subnet_ids" {
  description = "Subnets for the internal ALB."
  type        = list(string)

  validation {
    condition     = length(var.internal_subnet_ids) > 0
    error_message = "internal_subnet_ids must include at least one private subnet."
  }
}

variable "public_alb_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS on the public ALB."
  type        = string
  default     = null
}

variable "allow_plain_http_public_api" {
  description = "Whether to expose /v1 over plaintext HTTP when no ACM certificate is configured."
  type        = bool
  default     = false
}

variable "runtime_smoke_source_cidrs" {
  description = "Optional source CIDRs allowed to reach runtime smoke routes."
  type        = list(string)
  default     = []
}

variable "gl_coding_internal_auth_secret_arn" {
  description = "Optional Secrets Manager ARN for GL-coding internal authentication. Core Case must include the corresponding header when calling GL-coding. When supplied, the ALB enforces explicit routing rules."
  type        = string
  default     = null
}

variable "issue_payment_lambda_security_group_id" {
  description = "Optional security group ID for a VPC-attached Issue Payment Lambda. When supplied, the internal ALB allows ingress from it so the Lambda can reach Core Case's internal settlement route."
  type        = string
  default     = null
}
