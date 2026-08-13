variable "aws_profile" {
  description = "Optional AWS CLI profile for local Terraform runs. Leave null in CI."
  type        = string
  default     = null
}

variable "aws_region" {
  description = "AWS region for the Terraform remote state resources."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Optional override for the Terraform state bucket name."
  type        = string
  default     = null
}

variable "lock_table_name" {
  description = "Optional override for the Terraform lock table name."
  type        = string
  default     = null
}
