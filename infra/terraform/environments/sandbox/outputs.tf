output "vpc_id" {
  description = "Sandbox VPC ID."
  value       = local.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs used by the public ALB."
  value       = local.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs used by internal ALB and ECS services."
  value       = local.private_subnet_ids
}

output "public_alb_dns_name" {
  description = "Public ALB DNS name for Core Case routes."
  value       = module.alb.public_alb_dns_name
}

output "internal_alb_dns_name" {
  description = "Internal ALB DNS name for GL-coding."
  value       = module.alb.internal_alb_dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.ecs.cluster_name
}

output "core_case_repository_url" {
  description = "Core Case ECR repository URL."
  value       = module.ecs.core_case_repository_url
}

output "gl_coding_repository_url" {
  description = "GL-coding ECR repository URL."
  value       = module.ecs.gl_coding_repository_url
}

output "spa_bucket_name" {
  description = "Private S3 bucket for SPA assets."
  value       = module.spa.bucket_name
}

output "spa_cloudfront_domain_name" {
  description = "CloudFront domain name for the SPA."
  value       = module.spa.cloudfront_domain_name
}

output "stage_transition_sns_topic_arn" {
  description = "SNS topic ARN for Expense Report stage-transition events."
  value       = module.ecs.stage_transition_sns_topic_arn
}

output "stage_transition_sqs_queue_arn" {
  description = "SQS queue ARN for Expense Report stage-transition events."
  value       = module.ecs.stage_transition_sqs_queue_arn
}

output "stage_transition_sqs_queue_url" {
  description = "SQS queue URL for Expense Report stage-transition events."
  value       = module.ecs.stage_transition_sqs_queue_url
}

output "stage_transition_sqs_dlq_arn" {
  description = "SQS DLQ ARN for Expense Report stage-transition events."
  value       = module.ecs.stage_transition_sqs_dlq_arn
}

output "stage_transition_sqs_dlq_url" {
  description = "SQS DLQ URL for Expense Report stage-transition events."
  value       = module.ecs.stage_transition_sqs_dlq_url
}

output "dynamodb_expense_report_table_arn" {
  description = "DynamoDB table ARN for the Expense Report read projection."
  value       = module.ecs.dynamodb_expense_report_table_arn
}

output "dynamodb_expense_report_table_name" {
  description = "DynamoDB table name for the Expense Report read projection."
  value       = module.ecs.dynamodb_expense_report_table_name
}

output "dynamodb_expense_report_tenant_index_name" {
  description = "Tenant index name for the Expense Report read projection."
  value       = module.ecs.dynamodb_expense_report_tenant_index_name
}

output "core_case_db_endpoint" {
  description = "Connection endpoint (host:port) for the Core Case database."
  value       = module.database_core_case.db_endpoint
}

output "core_case_db_master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret for the Core Case database."
  value       = module.database_core_case.master_user_secret_arn
}

output "gl_coding_db_endpoint" {
  description = "Connection endpoint (host:port) for the GL-coding database."
  value       = module.database_gl_coding.db_endpoint
}

output "gl_coding_db_master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret for the GL-coding database."
  value       = module.database_gl_coding.master_user_secret_arn
}
