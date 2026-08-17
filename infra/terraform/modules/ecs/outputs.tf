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
  value       = aws_ecr_repository.core_case.repository_url
}

output "gl_coding_repository_url" {
  description = "GL-coding ECR repository URL."
  value       = aws_ecr_repository.gl_coding.repository_url
}
