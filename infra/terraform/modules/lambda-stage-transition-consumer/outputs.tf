output "function_name" {
  description = "Stage-transition consumer Lambda function name."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Stage-transition consumer Lambda function ARN."
  value       = aws_lambda_function.this.arn
}

output "security_group_id" {
  description = "Security group ID for the stage-transition consumer Lambda."
  value       = aws_security_group.this.id
}

output "repository_url" {
  description = "ECR repository URL for the stage-transition consumer Lambda image."
  value       = var.repository_url
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN of the derived database_url secret consumed by the Lambda."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "event_source_mapping_uuid" {
  description = "UUID of the SQS event-source mapping."
  value       = aws_lambda_event_source_mapping.stage_transition_events.uuid
}

output "log_group_name" {
  description = "CloudWatch log group name for the stage-transition consumer Lambda."
  value       = aws_cloudwatch_log_group.this.name
}
