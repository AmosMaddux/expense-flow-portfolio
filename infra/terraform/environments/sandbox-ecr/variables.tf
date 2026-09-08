variable "aws_profile" {
  description = "Optional AWS CLI profile for local Terraform runs. Leave null in CI."
  type        = string
  default     = null
}

variable "aws_region" {
  description = "AWS region for sandbox ECR repositories."
  type        = string
  default     = "us-east-1"
}

variable "resource_owner" {
  description = "Optional owner tag override. When null, Terraform derives the owner from the AWS caller identity."
  type        = string
  default     = null

  validation {
    condition     = var.resource_owner == null ? true : trimspace(var.resource_owner) != ""
    error_message = "resource_owner must be null or a non-empty string."
  }
}

variable "name_prefix" {
  description = "Prefix used for sandbox ECR repository names."
  type        = string
  default     = "expenseflow-sandbox"
}
