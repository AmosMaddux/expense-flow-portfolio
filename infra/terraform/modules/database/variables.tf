variable "name_prefix" {
  description = "Name prefix for database resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable database resources."
  type        = map(string)
  default     = {}
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN for the RDS enhanced-monitoring role."
  type        = string
  default     = null
}

variable "enable_enhanced_monitoring" {
  description = "Whether to enable RDS Enhanced Monitoring. Some sandbox accounts deny iam:PassRole to monitoring.rds.amazonaws.com; set to false there."
  type        = bool
  default     = true
}

variable "vpc_id" {
  description = "VPC ID for the database security group."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "private_subnet_ids must include at least two private subnets, in at least two distinct Availability Zones, so RDS can create a DB subnet group. A single subnet passes this check but is still rejected by RDS at apply time if it does not provide multi-AZ coverage."
  }

  validation {
    condition     = length(var.private_subnet_ids) == length(toset(var.private_subnet_ids))
    error_message = "private_subnet_ids must not contain duplicate subnet IDs."
  }
}

variable "allowed_security_group_ids" {
  description = "Security group IDs permitted to connect to the database on the PostgreSQL port."
  type        = list(string)

  validation {
    condition     = length(var.allowed_security_group_ids) > 0
    error_message = "allowed_security_group_ids must include at least one security group."
  }
}

variable "service_name" {
  description = "Short service identifier used in resource names, e.g. \"core-case\" or \"gl-coding\"."
  type        = string

  validation {
    condition     = trimspace(var.service_name) != ""
    error_message = "service_name must not be empty."
  }
}

variable "database_name" {
  description = "Name of the default database created on the instance. Defaults to service_name with hyphens replaced by underscores."
  type        = string
  default     = null
}

variable "master_username" {
  description = "Master username for the RDS instance. Defaults to \"<service_name>_admin\" with hyphens replaced by underscores."
  type        = string
  default     = null
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.4"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 20
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period > 0
    error_message = "backup_retention_period must be greater than 0 to enable automated backups."
  }
}

variable "multi_az" {
  description = "Whether to deploy a standby replica in another availability zone."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on the instance."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Whether to skip the final snapshot when the instance is destroyed."
  type        = bool
  default     = true
}

variable "readonly_roles" {
  description = <<-EOT
    Optional map of least-privilege database roles to create, keyed by role
    name. Each role gets SELECT-only access to the listed tables and nothing
    else - no other tables, no INSERT/UPDATE/DELETE/DDL. Use this instead of
    handing a consuming service the RDS master user credentials.
  EOT
  type = map(object({
    tables = list(string)
  }))
  default = {}
}

variable "extensions" {
  description = <<-EOT
    PostgreSQL extensions to create in the database. Application migrations run
    as the service user and cannot create extensions themselves, so any
    extension the schema depends on must be provisioned here by the master
    user. Core Case needs "vector" for policy retrieval embeddings.
  EOT
  type        = set(string)
  default     = []
}
