data "aws_caller_identity" "current" {}

locals {
  # Keep this tag derivation aligned with ../sandbox/main.tf.
  caller_name = try(regex("(user|assumed-role)/([^/@]+)", data.aws_caller_identity.current.arn)[1], "unknown")

  tags = {
    env  = "sandbox"
    user = coalesce(var.resource_owner, local.caller_name)
  }
}

resource "aws_ecr_repository" "core_case" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-core-case-service"
  image_tag_mutability = "IMMUTABLE"
  tags                 = local.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "gl_coding" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-gl-coding-service"
  image_tag_mutability = "IMMUTABLE"
  tags                 = local.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "stage_transition_consumer_lambda" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-stage-transition-consumer-lambda"
  image_tag_mutability = "IMMUTABLE"
  tags                 = local.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}
