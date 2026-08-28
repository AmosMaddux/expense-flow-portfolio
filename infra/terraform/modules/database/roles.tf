locals {
  # postgresql_role/postgresql_grant/postgresql_extension all use the
  # postgresql provider, which needs network access to the private RDS
  # instance - gated by readonly_roles_and_extensions_enabled so a routine
  # apply from outside the VPC skips them instead of failing on a
  # connection timeout. See the variable's description.
  enabled_readonly_roles = var.readonly_roles_and_extensions_enabled ? var.readonly_roles : {}
  enabled_extensions     = var.readonly_roles_and_extensions_enabled ? var.extensions : []
}

resource "random_password" "readonly_role" {
  for_each = var.readonly_roles

  length  = 32
  special = false
}

resource "postgresql_role" "readonly" {
  for_each = local.enabled_readonly_roles

  name     = each.key
  login    = true
  password = random_password.readonly_role[each.key].result
}

resource "postgresql_grant" "readonly_tables" {
  for_each = local.enabled_readonly_roles

  database    = local.database_name
  role        = postgresql_role.readonly[each.key].name
  schema      = "public"
  object_type = "table"
  objects     = each.value.tables
  privileges  = ["SELECT"]
}

data "aws_iam_policy_document" "readonly_role_secrets_kms" {
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
      # Secrets Manager's CreateSecret call encrypts the initial secret value
      # under the caller's own KMS grant, not only the service principal's -
      # without this, CreateSecret fails "Access to KMS is not allowed" even
      # though the caller can otherwise administer the key.
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey*",
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
    sid = "AllowSecretsManagerUseOfKey"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = [
      "arn:aws:kms:*:${data.aws_caller_identity.current.account_id}:key/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["secretsmanager.amazonaws.com"]
    }

    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }
}

resource "aws_kms_key" "readonly_role_secrets" {
  description         = "Encrypts the ${var.service_name} read-only database role secrets."
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.readonly_role_secrets_kms.json
  tags                = var.tags
}

resource "aws_kms_alias" "readonly_role_secrets" {
  name          = "alias/${var.name_prefix}-${var.service_name}-db-readonly"
  target_key_id = aws_kms_key.readonly_role_secrets.key_id
}

resource "aws_secretsmanager_secret" "readonly_role" {
  #checkov:skip=CKV2_AWS_57: Rotating these credentials needs a rotation Lambda and the postgresql provider to re-apply the role password; tracked as follow-up, owner platform-security, review by 2026-11-30
  for_each = var.readonly_roles

  name       = "${var.name_prefix}-${var.service_name}-db-${each.key}"
  kms_key_id = aws_kms_key.readonly_role_secrets.arn
  tags       = var.tags
}

resource "aws_secretsmanager_secret_version" "readonly_role" {
  for_each = local.enabled_readonly_roles

  secret_id = aws_secretsmanager_secret.readonly_role[each.key].id
  secret_string = jsonencode({
    username = postgresql_role.readonly[each.key].name
    password = random_password.readonly_role[each.key].result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = local.database_name
  })
}

resource "postgresql_extension" "this" {
  for_each = local.enabled_extensions

  name     = each.value
  database = local.database_name
}
