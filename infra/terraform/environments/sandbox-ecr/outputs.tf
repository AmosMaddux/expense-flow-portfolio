output "core_case_repository_name" {
  description = "Core Case ECR repository name."
  value       = aws_ecr_repository.core_case.name
}

output "core_case_repository_url" {
  description = "Core Case ECR repository URL."
  value       = aws_ecr_repository.core_case.repository_url
}

output "core_case_repository_arn" {
  description = "Core Case ECR repository ARN."
  value       = aws_ecr_repository.core_case.arn
}

output "gl_coding_repository_name" {
  description = "GL-coding ECR repository name."
  value       = aws_ecr_repository.gl_coding.name
}

output "gl_coding_repository_url" {
  description = "GL-coding ECR repository URL."
  value       = aws_ecr_repository.gl_coding.repository_url
}

output "gl_coding_repository_arn" {
  description = "GL-coding ECR repository ARN."
  value       = aws_ecr_repository.gl_coding.arn
}

output "stage_transition_lambda_repository_name" {
  description = "Stage-transition consumer Lambda ECR repository name."
  value       = aws_ecr_repository.stage_transition_consumer_lambda.name
}

output "stage_transition_lambda_repository_url" {
  description = "Stage-transition consumer Lambda ECR repository URL."
  value       = aws_ecr_repository.stage_transition_consumer_lambda.repository_url
}

output "stage_transition_lambda_repository_arn" {
  description = "Stage-transition consumer Lambda ECR repository ARN."
  value       = aws_ecr_repository.stage_transition_consumer_lambda.arn
}
