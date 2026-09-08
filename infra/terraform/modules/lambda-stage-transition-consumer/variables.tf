variable "name_prefix" {
  description = "Name prefix for stage-transition consumer Lambda resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable Lambda resources."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region for Lambda runtime configuration."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the Lambda security group."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Lambda VPC attachment."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) > 0
    error_message = "private_subnet_ids must include at least one private subnet."
  }
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN for the Lambda execution role."
  type        = string
  default     = null
}

variable "image_uri" {
  description = "Optional immutable container image URI for the stage-transition consumer Lambda. Defaults to the persistent ECR repository's :latest tag."
  type        = string
  default     = null
}

variable "repository_url" {
  description = "Persistent ECR repository URL for stage-transition consumer Lambda images."
  type        = string
}

variable "timeout_seconds" {
  description = "Lambda function timeout in seconds."
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda function memory size in MB."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days for the Lambda log group."
  type        = number
  default     = 365
}

variable "stage_transition_sqs_queue_arn" {
  description = "ARN of the stage-transition SQS queue this Lambda consumes."
  type        = string
}

variable "stage_transition_sqs_dlq_arn" {
  description = "ARN of the stage-transition SQS dead-letter queue, for read-only DLQ visibility permissions."
  type        = string
}

variable "event_source_batch_size" {
  description = "Maximum number of SQS messages delivered per Lambda invocation."
  type        = number
  default     = 10

  validation {
    condition     = var.event_source_batch_size >= 1 && var.event_source_batch_size <= 10
    error_message = "event_source_batch_size must be between 1 and 10 for a standard SQS queue."
  }
}

variable "event_source_mapping_enabled" {
  description = "Whether the SQS event-source mapping is enabled."
  type        = bool
  default     = true
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
