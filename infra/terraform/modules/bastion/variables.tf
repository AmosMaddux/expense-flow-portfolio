variable "name_prefix" {
  description = "Name prefix for bastion resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to taggable bastion resources. Must satisfy this account's tagging SCP: an aws:RequestTag/user tag and aws:RequestTag/env=sandbox, or ec2:RunInstances (and the other resource-creating actions the SCP covers) is denied."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC ID for the bastion security group."
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID to launch the bastion instance in. The VPC must already have ssm, ssmmessages, and ec2messages interface endpoints (or NAT/internet egress) for SSM connectivity."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the bastion. This account's SCP restricts instances to the t2/t3/t4g families."
  type        = string
  default     = "t3.micro"

  validation {
    condition     = can(regex("^t(2|3|4g)\\.", var.instance_type))
    error_message = "instance_type must be in the t2, t3, or t4g family per this account's SCP."
  }
}

variable "role_permissions_boundary_arn" {
  description = "Optional IAM permissions boundary ARN for the bastion role."
  type        = string
  default     = null
}

variable "core_case_repository_url" {
  description = "ECR repository URL for the core-case-service image the bastion pulls to run migrations, seed accounts, and generate MFA codes."
  type        = string
}

variable "core_case_repository_url_arn" {
  description = "ECR repository ARN matching core_case_repository_url, used to scope the bastion's pull permissions."
  type        = string
}

variable "core_case_image_tag" {
  description = "Image tag the bastion pulls from core_case_repository_url. Should track whatever tag is actually deployed to ECS."
  type        = string
  default     = "latest"
}

variable "database_master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret. The bastion reads this to run migrations and seed accounts; it is never printed or logged (see scripts/bastion-run.sh)."
  type        = string
}

variable "mfa_totp_secret_encryption_key_secret_arn" {
  description = "Secrets Manager ARN of the MFA TOTP secret encryption key, required by the seed and MFA-code commands."
  type        = string
}

variable "receipt_storage_bucket_arn" {
  description = "Optional ARN of the receipt storage S3 bucket. When set, the bastion can PutObject/HeadObject there, for the demo-seed command's synthetic receipt fixtures."
  type        = string
  default     = null
}
