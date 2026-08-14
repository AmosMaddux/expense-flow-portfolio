variable "name_prefix" {
  description = "Name prefix for database resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable database resources."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC ID for the database security group."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) > 0
    error_message = "private_subnet_ids must include at least one private subnet."
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

variable "database_name" {
  description = "Name of the default database created on the instance."
  type        = string
  default     = "core_case"
}

variable "master_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "core_case_admin"
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
