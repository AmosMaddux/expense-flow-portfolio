variable "name_prefix" {
  description = "Name prefix for Redis resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable Redis resources."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC ID for the Redis security group."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the ElastiCache subnet group."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) > 0
    error_message = "private_subnet_ids must include at least one private subnet."
  }
}

variable "allowed_security_group_ids" {
  description = "Security group IDs permitted to connect to Redis on the Redis port."
  type        = list(string)

  validation {
    condition     = length(var.allowed_security_group_ids) > 0
    error_message = "allowed_security_group_ids must include at least one security group."
  }
}

variable "service_name" {
  description = "Short service identifier used in resource names, e.g. \"core-case\"."
  type        = string

  validation {
    condition     = trimspace(var.service_name) != ""
    error_message = "service_name must not be empty."
  }
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "ElastiCache node instance type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "port" {
  description = "Port Redis listens on."
  type        = number
  default     = 6379
}

variable "snapshot_retention_limit" {
  description = "Number of days to retain automatic Redis snapshots."
  type        = number
  default     = 1
}
