output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "core_case_service_name" {
  description = "Core Case ECS service name."
  value       = aws_ecs_service.core_case.name
}

output "gl_coding_service_name" {
  description = "GL-coding ECS service name."
  value       = aws_ecs_service.gl_coding.name
}

output "core_case_security_group_id" {
  description = "Core Case task security group ID."
  value       = aws_security_group.core_case.id
}

output "gl_coding_security_group_id" {
  description = "GL-coding task security group ID."
  value       = aws_security_group.gl_coding.id
}

output "core_case_repository_url" {
  description = "Core Case ECR repository URL."
  value       = var.core_case_repository_url
}

output "core_case_repository_arn" {
  description = "Core Case ECR repository ARN."
  value       = var.core_case_repository_arn
}

output "receipt_storage_bucket_arn" {
  description = "Receipt storage S3 bucket ARN."
  value       = aws_s3_bucket.receipts.arn
}

output "gl_coding_repository_url" {
  description = "GL-coding ECR repository URL."
  value       = var.gl_coding_repository_url
}

output "stage_transition_sns_topic_arn" {
  description = "SNS topic ARN for Expense Report stage-transition events."
  value       = aws_sns_topic.stage_transitions.arn
}

output "stage_transition_sqs_queue_arn" {
  description = "SQS queue ARN for Expense Report stage-transition events."
  value       = aws_sqs_queue.stage_transition_events.arn
}

output "stage_transition_sqs_queue_url" {
  description = "SQS queue URL for Expense Report stage-transition events."
  value       = aws_sqs_queue.stage_transition_events.url
}

output "stage_transition_sqs_dlq_arn" {
  description = "SQS DLQ ARN for Expense Report stage-transition events."
  value       = aws_sqs_queue.stage_transition_events_dlq.arn
}

output "stage_transition_sqs_dlq_url" {
  description = "SQS DLQ URL for Expense Report stage-transition events."
  value       = aws_sqs_queue.stage_transition_events_dlq.url
}

output "dynamodb_expense_report_table_arn" {
  description = "DynamoDB table ARN for the Expense Report read projection."
  value       = aws_dynamodb_table.expense_report_projection.arn
}

output "dynamodb_expense_report_table_name" {
  description = "DynamoDB table name for the Expense Report read projection."
  value       = aws_dynamodb_table.expense_report_projection.name
}

output "dynamodb_expense_report_tenant_index_name" {
  description = "Tenant index name for the Expense Report read projection."
  value       = var.dynamodb_expense_report_tenant_index_name
}
