variable "name_prefix" {
  description = "Name prefix for ALB resources."
  type        = string
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
