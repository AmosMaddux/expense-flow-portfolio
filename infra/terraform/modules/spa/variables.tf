variable "name_prefix" {
  description = "Name prefix for SPA resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable SPA resources."
  type        = map(string)
  default     = {}
}

variable "bucket_name" {
  description = "Name for the private SPA S3 bucket."
  type        = string
}

variable "cache_policy_id" {
  description = "CloudFront cache policy ID."
  type        = string
  default     = "658327ea-f89d-4fab-a63d-7e88639e58f6"
}
