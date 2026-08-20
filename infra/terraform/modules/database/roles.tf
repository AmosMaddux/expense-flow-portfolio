resource "random_password" "readonly_role" {
  for_each = var.readonly_roles

  length  = 32
  special = false
}

resource "postgresql_role" "readonly" {
  for_each = var.readonly_roles

  name     = each.key
  login    = true
  password = random_password.readonly_role[each.key].result
}

resource "postgresql_grant" "readonly_tables" {
  for_each = var.readonly_roles

  database    = local.database_name
  role        = postgresql_role.readonly[each.key].name
  schema      = "public"
  object_type = "table"
  objects     = each.value.tables
  privileges  = ["SELECT"]
}

resource "aws_secretsmanager_secret" "readonly_role" {
  for_each = var.readonly_roles

  name = "${var.name_prefix}-${var.service_name}-db-${each.key}"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "readonly_role" {
  for_each = var.readonly_roles

  secret_id = aws_secretsmanager_secret.readonly_role[each.key].id
  secret_string = jsonencode({
    username = postgresql_role.readonly[each.key].name
    password = random_password.readonly_role[each.key].result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = local.database_name
  })
}
