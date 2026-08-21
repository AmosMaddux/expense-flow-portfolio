output "api_id" {
  description = "HTTP API identifier."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Base invoke URL for the HTTP API stage."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/${aws_apigatewayv2_stage.this.name}"
}

output "authorizer_id" {
  description = "Shared JWT authorizer identifier."
  value       = aws_apigatewayv2_authorizer.shared_jwt.id
}

output "claims_probe_function_name" {
  description = "Claims-probe Lambda function name."
  value       = aws_lambda_function.claims_probe.function_name
}

output "claims_probe_url" {
  description = "Protected claims-probe URL used by the JWT gateway smoke test."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/${aws_apigatewayv2_stage.this.name}/auth-context"
}

output "issue_payment_function_name" {
  description = "Issue Payment Lambda function name."
  value       = aws_lambda_function.issue_payment.function_name
}

output "issue_payment_url_prefix" {
  description = "Protected Issue Payment URL prefix. Append an Expense Report ID before /settlement, e.g. \"$${issue_payment_url_prefix}$${expense_report_id}/settlement\"."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/${aws_apigatewayv2_stage.this.name}/expense-reports/"
}

output "issue_payment_lambda_security_group_id" {
  description = "Security group ID for the VPC-attached Issue Payment Lambda, or null when it runs outside the VPC. Callers reaching Core Case's internal route over the internal ALB must allow ingress from this security group."
  value       = local.vpc_config_enabled ? aws_security_group.issue_payment[0].id : null
}
