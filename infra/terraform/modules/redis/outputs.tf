output "security_group_id" {
  description = "Security group ID for the Redis replication group."
  value       = aws_security_group.this.id
}

output "redis_url_secret_arn" {
  description = "Secrets Manager ARN of the assembled rediss:// connection URL, including the auth token."
  value       = aws_secretsmanager_secret.redis_url.arn
}

output "primary_endpoint_address" {
  description = "Primary endpoint hostname for the Redis replication group. Does not include credentials."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Port the Redis replication group listens on."
  value       = aws_elasticache_replication_group.this.port
}
