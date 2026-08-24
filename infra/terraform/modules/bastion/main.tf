data "aws_ssm_parameter" "amazon_linux" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-bastion-sg"
  description = "Temporary-access bastion for sandbox database migrations, account seeding, and MFA code generation. No inbound rules - reachable only via SSM Session Manager."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-bastion-sg"
  })
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr Egress is required to reach ECR/SSM/Secrets Manager VPC endpoints and pull images; the bastion has no inbound rule and no public IP, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "all" {
  #checkov:skip=CKV_AWS_382: Egress does not leave the VPC in practice (VPC endpoints cover ECR/SSM/Secrets Manager), owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.this.id
  description       = "Allow bastion outbound traffic (VPC endpoints, RDS)."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name                 = "${var.name_prefix}-bastion"
  assume_role_policy   = data.aws_iam_policy_document.assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "bastion_permissions" {
  statement {
    sid = "PullCoreCaseImage"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid = "PullCoreCaseImageFromRepository"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [var.core_case_repository_url_arn]
  }

  statement {
    sid       = "ReadDatabaseAndMfaSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.database_master_user_secret_arn, var.mfa_totp_secret_encryption_key_secret_arn]
  }

  dynamic "statement" {
    for_each = var.receipt_storage_bucket_arn == null ? [] : [var.receipt_storage_bucket_arn]

    content {
      sid = "SeedDemoReceipts"
      actions = [
        "s3:PutObject",
        "s3:HeadObject",
      ]
      resources = ["${statement.value}/*"]
    }
  }
}

resource "aws_iam_role_policy" "bastion_permissions" {
  name   = "${var.name_prefix}-bastion-permissions"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.bastion_permissions.json
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name_prefix}-bastion"
  role = aws_iam_role.this.name
}

locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y docker
    systemctl enable --now docker
  EOT
}

#tfsec:ignore:aws-ec2-enforce-http-token-imds IMDSv2 is enforced via metadata_options below, owner platform-security, review by 2026-12-31
resource "aws_instance" "this" {
  #checkov:skip=CKV_AWS_88: No public IP is assigned (associate_public_ip_address = false); reachable only via SSM, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_126: Detailed monitoring is unnecessary for an on-demand operational bastion, owner platform-security, review by 2026-12-31
  ami                         = data.aws_ssm_parameter.amazon_linux.value
  instance_type               = var.instance_type
  subnet_id                   = var.private_subnet_id
  vpc_security_group_ids      = [aws_security_group.this.id]
  iam_instance_profile        = aws_iam_instance_profile.this.name
  associate_public_ip_address = false
  ebs_optimized               = true
  user_data                   = local.user_data

  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    encrypted = true
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-bastion"
  })

  volume_tags = merge(var.tags, {
    Name = "${var.name_prefix}-bastion"
  })
}
