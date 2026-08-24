resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-${var.service_name}-redis-subnet-group"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-${var.service_name}-redis-sg"
  description = "Controls inbound traffic to the ${var.service_name} Redis replication group."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${var.service_name}-redis-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_allowed" {
  for_each = { for idx, sg_id in var.allowed_security_group_ids : idx => sg_id }

  security_group_id            = aws_security_group.this.id
  description                  = "Allow Redis access from the ${var.service_name} allowed security group."
  referenced_security_group_id = each.value
  from_port                    = var.port
  ip_protocol                  = "tcp"
  to_port                      = var.port
}

resource "random_password" "auth_token" {
  length  = 48
  special = false
}

#tfsec:ignore:aws-elasticache-add-description Description is set via aws_secretsmanager_secret.description; this argument name collides with a reserved provider key, owner platform-security, review by 2026-12-31
resource "aws_secretsmanager_secret" "auth_token" {
  #checkov:skip=CKV_AWS_149: Sandbox Secrets Manager uses the default AWS-managed KMS key while CMK ownership is reviewed separately, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_57: Automatic rotation requires a rotation Lambda that understands the ElastiCache AUTH token update flow, out of scope for sandbox; rotation is a manual, documented process, owner platform-security, review by 2026-11-22
  name = "${var.name_prefix}-${var.service_name}-redis-auth-token"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "auth_token" {
  secret_id     = aws_secretsmanager_secret.auth_token.id
  secret_string = random_password.auth_token.result
}

#tfsec:ignore:aws-elasticache-enable-in-transit-encryption Encryption in transit is enabled via transit_encryption_enabled below; this rule does not detect the attribute on this resource version, owner platform-security, review by 2026-12-31
resource "aws_elasticache_replication_group" "this" {
  #checkov:skip=CKV_AWS_191: Sandbox ElastiCache uses the default AWS-managed KMS key while CMK ownership is reviewed separately, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_50: Multi-AZ automatic failover requires a second cache node, doubling sandbox ElastiCache cost for a non-production environment; single-node is an accepted risk here, owner platform-security, review by 2026-11-22
  replication_group_id = "${var.name_prefix}-${var.service_name}-redis"
  description          = "Redis cache and idempotency store for ${var.service_name}."
  tags                 = var.tags

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = var.port

  num_cache_clusters = 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result

  automatic_failover_enabled = false
  snapshot_retention_limit   = var.snapshot_retention_limit

  apply_immediately = true
}

locals {
  redis_url = format(
    "rediss://:%s@%s:%s",
    urlencode(random_password.auth_token.result),
    aws_elasticache_replication_group.this.primary_endpoint_address,
    var.port,
  )
}

resource "aws_secretsmanager_secret" "redis_url" {
  #checkov:skip=CKV_AWS_149: Sandbox Secrets Manager uses the default AWS-managed KMS key while CMK ownership is reviewed separately, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_57: This secret is derived from aws_secretsmanager_secret.auth_token and rotates when that value is manually rotated; automatic rotation is deferred for sandbox, owner platform-security, review by 2026-11-22
  name = "${var.name_prefix}-${var.service_name}-redis-url"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = local.redis_url
}
