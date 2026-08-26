output "dashboard_name" {
  description = "CloudWatch dashboard name for ExpenseFlow observability."
  value       = aws_cloudwatch_dashboard.this.dashboard_name
}

output "namespace" {
  description = "CloudWatch metrics namespace for ExpenseFlow observability."
  value       = local.namespace
}
