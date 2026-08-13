variable "name_prefix" {
  description = "Name prefix for ALB resources."
  type        = string
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

variable "vpc_id" {
  description = "VPC ID for load balancers and target groups."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block allowed to reach the internal ALB."
  type        = string
}

variable "public_subnet_ids" {
  description = "Subnets for the internet-facing ALB."
  type        = list(string)
}

variable "internal_subnet_ids" {
  description = "Subnets for the internal ALB."
  type        = list(string)
}

variable "public_alb_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS on the public ALB."
  type        = string
  default     = null
}

variable "runtime_smoke_source_cidrs" {
  description = "Optional source CIDRs allowed to reach runtime smoke routes through HTTPS."
  type        = list(string)
  default     = []
}
