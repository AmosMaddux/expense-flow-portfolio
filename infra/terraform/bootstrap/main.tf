terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

locals {
  state_bucket_name = coalesce(
    var.state_bucket_name,
    "expenseflow-sandbox-terraform-state-${data.aws_caller_identity.current.account_id}-${var.aws_region}",
  )

  # Keep this tag derivation aligned with ../environments/sandbox/main.tf.
  caller_name = try(regex("(user|assumed-role)/([^/@]+)", data.aws_caller_identity.current.arn)[1], "unknown")

  tags = {
    user = coalesce(var.resource_owner, local.caller_name)
    env  = "sandbox"
  }
}

#tfsec:ignore:aws-s3-enable-bucket-logging State bucket access logging needs a separate log archive bucket outside SCRUM-154, owner platform-security, review by 2026-12-31
resource "aws_s3_bucket" "terraform_state" {
  #checkov:skip=CKV_AWS_18: State bucket access logging needs a separate log archive bucket outside SCRUM-154, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_144: Cross-region state replication is deferred for sandbox cost and bootstrap simplicity, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_145: State bucket KMS re-encryption is split for IAM review to avoid locking Terraform users out, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_61: State bucket lifecycle policy is deferred until retention requirements are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_62: State bucket event notifications are deferred until audit ingestion is designed, owner platform-security, review by 2026-12-31  bucket = local.state_bucket_name
  tags = local.tags
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

#tfsec:ignore:aws-s3-encryption-customer-key State bucket KMS re-encryption is split for IAM review to avoid locking Terraform users out, owner platform-security, review by 2026-12-31
resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}