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
  description = "Connection endpoint (host:port) for the Core Case database, also used by GL-coding for GL reference table lookups."
  value       = module.database_core_case.db_endpoint
}

output "core_case_db_master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master user secret for the Core Case database, also used by GL-coding for GL reference table lookups."
  value       = module.database_core_case.master_user_secret_arn
}

output "stage_transition_consumer_lambda_function_name" {
  description = "Function name of the stage-transition consumer Lambda."
  value       = module.lambda_stage_transition_consumer.function_name
}

output "stage_transition_consumer_lambda_repository_url" {
  description = "ECR repository URL for the stage-transition consumer Lambda image."
  value       = module.lambda_stage_transition_consumer.repository_url
}

output "stage_transition_consumer_event_source_mapping_uuid" {
  description = "UUID of the SQS event-source mapping wiring the stage-transition queue to the consumer Lambda."
  value       = module.lambda_stage_transition_consumer.event_source_mapping_uuid
}

output "http_api_endpoint" {
  description = "Base invoke URL for the HTTP API stage."
  value       = module.http_api.api_endpoint
}

output "http_api_claims_probe_url" {
  description = "Protected claims-probe URL used by the JWT gateway smoke test."
  value       = module.http_api.claims_probe_url
}

output "http_api_issue_payment_url_prefix" {
  description = "Protected Issue Payment (API Gateway payment path) URL prefix. Append an Expense Report ID before /settlement."
  value       = module.http_api.issue_payment_url_prefix
}

