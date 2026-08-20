output "db_endpoint" {
  description = "Connection endpoint (host:port) for the database instance."
  value       = aws_db_instance.this.endpoint
}

output "db_address" {
  description = "Hostname of the database instance, without the port."
  value       = aws_db_instance.this.address
}

output "db_port" {
  description = "Port the database instance listens on."
  value       = aws_db_instance.this.port
}

output "master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "db_name" {
  description = "Database name on the instance."
  value       = aws_db_instance.this.db_name
}

output "master_username" {
  description = "Master username for the database instance."
  value       = aws_db_instance.this.username
}

output "security_group_id" {
  description = "Security group ID for the database instance."
  value       = aws_security_group.this.id
}

output "readonly_role_secret_arns" {
  description = "Secrets Manager ARNs of each readonly_roles credential, keyed by role name."
  value       = { for name, secret in aws_secretsmanager_secret.readonly_role : name => secret.arn }
}
