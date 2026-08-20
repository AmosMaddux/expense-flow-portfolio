output "public_alb_security_group_id" {
  description = "Security group ID for the public ALB."
  value       = aws_security_group.public_alb.id
}

output "internal_alb_security_group_id" {
  description = "Security group ID for the internal ALB."
  value       = aws_security_group.internal_alb.id
}

output "core_case_target_group_arn" {
  description = "Target group ARN for the Core Case service."
  value       = aws_lb_target_group.core_case.arn
}

output "gl_coding_target_group_arn" {
  description = "Target group ARN for the GL-coding service."
  value       = aws_lb_target_group.gl_coding.arn
}

output "public_alb_dns_name" {
  description = "DNS name of the public ALB."
  value       = aws_lb.public.dns_name
}

output "internal_alb_dns_name" {
  description = "DNS name of the internal ALB."
  value       = aws_lb.internal.dns_name
}

output "public_alb_name" {
  description = "Name of the public ALB, for AWS CLI name-based lookups."
  value       = aws_lb.public.name
}

output "internal_alb_name" {
  description = "Name of the internal ALB, for AWS CLI name-based lookups."
  value       = aws_lb.internal.name
}

output "core_case_target_group_name" {
  description = "Name of the Core Case target group, for AWS CLI name-based lookups."
  value       = aws_lb_target_group.core_case.name
}

output "gl_coding_target_group_name" {
  description = "Name of the GL-coding target group, for AWS CLI name-based lookups."
  value       = aws_lb_target_group.gl_coding.name
}
