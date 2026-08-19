locals {
  service_name_underscored = replace(var.service_name, "-", "_")
  database_name            = coalesce(var.database_name, local.service_name_underscored)
  master_username          = coalesce(var.master_username, "${local.service_name_underscored}_admin")
  engine_major_version     = split(".", var.engine_version)[0]
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-${var.service_name}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${var.service_name}-db-subnet-group"
  })
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-${var.service_name}-db-sg"
  description = "Controls inbound traffic to the ${var.service_name} PostgreSQL instance."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${var.service_name}-db-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_allowed" {
  for_each = { for idx, sg_id in var.allowed_security_group_ids : idx => sg_id }

  security_group_id            = aws_security_group.this.id
  description                  = "Allow PostgreSQL access from ${var.service_name}'s allowed security group."
  referenced_security_group_id = each.value
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

data "aws_iam_policy_document" "rds_monitoring_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name               = "${var.name_prefix}-${var.service_name}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.rds_monitoring_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "performance_insights_kms" {
  statement {
    sid = "AllowAccountRootKeyAdministration"
    actions = [
      "kms:Create*",
      "kms:Describe*",
      "kms:Enable*",
      "kms:List*",
      "kms:Put*",
      "kms:Update*",
      "kms:Revoke*",
      "kms:Disable*",
      "kms:Get*",
      "kms:Delete*",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion",
    ]
    resources = [
      "arn:aws:kms:*:${data.aws_caller_identity.current.account_id}:key/*",
    ]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid = "AllowRDSServiceUseOfKey"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [
      "arn:aws:kms:*:${data.aws_caller_identity.current.account_id}:key/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "performance_insights" {
  description         = "Encrypts Performance Insights data for the ${var.service_name} database."
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.performance_insights_kms.json
  tags                = var.tags
}

resource "aws_kms_alias" "performance_insights" {
  name          = "alias/${var.name_prefix}-${var.service_name}-rds-pi"
  target_key_id = aws_kms_key.performance_insights.key_id
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name_prefix}-${var.service_name}-pg-"
  family      = "postgres${local.engine_major_version}"
  tags        = var.tags

  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

#tfsec:ignore:aws-rds-enable-iam-auth IAM database authentication requires application-level IAM token wiring not yet built, owner platform-security, review by 2026-12-31
resource "aws_db_instance" "this" {
  #checkov:skip=CKV_AWS_161: IAM database authentication requires application-level IAM token wiring not yet built, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_157: Multi-AZ is caller-configurable via var.multi_az and defaults off to keep sandbox cost down, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_293: Deletion protection is caller-configurable via var.deletion_protection and defaults off for sandbox teardown convenience, owner platform-security, review by 2026-12-31
  identifier     = "${var.name_prefix}-${var.service_name}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class
  db_name        = local.database_name
  username       = local.master_username
  tags           = var.tags

  allocated_storage = var.allocated_storage
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  parameter_group_name   = aws_db_parameter_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false

  manage_master_user_password = true

  backup_retention_period = var.backup_retention_period
  copy_tags_to_snapshot   = true
  multi_az                = var.multi_az
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = var.skip_final_snapshot

  auto_minor_version_upgrade = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.performance_insights.arn
}
