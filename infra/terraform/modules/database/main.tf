locals {
  service_name_underscored = replace(var.service_name, "-", "_")
  database_name            = coalesce(var.database_name, local.service_name_underscored)
  master_username          = coalesce(var.master_username, "${local.service_name_underscored}_admin")
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
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_db_instance" "this" {
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
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false

  manage_master_user_password = true

  backup_retention_period = var.backup_retention_period
  multi_az                = var.multi_az
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = var.skip_final_snapshot
}
