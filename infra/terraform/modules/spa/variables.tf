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

variable "api_origin_domain_name" {
  description = <<-EOT
    Optional DNS name of an HTTP-only API origin (e.g. Core Case's public
    ALB) that CloudFront proxies /v1/* to over plain HTTP. The browser only
    ever talks to CloudFront over HTTPS - this origin-to-origin hop is
    invisible to the browser's mixed-content check, so the origin does not
    need a certificate. Leave null to serve only the SPA (no API proxying).
  EOT
  type        = string
  default     = null
}
