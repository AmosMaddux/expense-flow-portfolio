variable "name_prefix" {
  description = "Name prefix for observability resources."
  type        = string
}

variable "aws_region" {
  description = "AWS region for dashboard link generation."
  type        = string
}

variable "tags" {
  description = "Tags applied to observability resources."
  type        = map(string)
  default     = {}
}

variable "core_case_log_group_name" {
  description = "CloudWatch log group name for Core Case."
  type        = string
}

variable "gl_coding_log_group_name" {
  description = "CloudWatch log group name for GL-coding."
  type        = string
}

variable "stage_transition_lambda_log_group_name" {
  description = "CloudWatch log group name for the stage-transition Lambda."
  type        = string
}
