data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      identifiers = ["lambda.amazonaws.com"]
      type        = "Service"
    }
  }
}

locals {
  vpc_config_enabled = var.vpc_id != null && length(var.private_subnet_ids) > 0
}

# The application's esbuild bundles (npm run build:lambda in platform/http-api)
# produce raw .js files; SAM zips them implicitly during `sam build`. Terraform
# requires an actual zip archive for a non-image Lambda deployment package, so
# this reproduces that same zipping step without changing the bundling itself.
data "archive_file" "claims_probe" {
  type        = "zip"
  source_file = var.claims_probe_build_output
  output_path = "${path.module}/.build/claims-probe.zip"
}

data "archive_file" "issue_payment" {
  type        = "zip"
  source_file = var.issue_payment_build_output
  output_path = "${path.module}/.build/issue-payment.zip"
}

# Shared HTTP API + native JWT authorizer.
# Every route inherits this authorizer as its default unless a route
# explicitly overrides it, matching platform/http-api/template.yaml.

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"
  tags          = var.tags
}

resource "aws_apigatewayv2_authorizer" "shared_jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "SharedJwtAuthorizer"

  jwt_configuration {
    audience = [var.jwt_audience]
    issuer   = var.jwt_issuer
  }
}

resource "aws_cloudwatch_log_group" "access_logs" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-11-22
  name              = "/aws/apigateway/${var.name_prefix}-http-api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = var.stage_name
  auto_deploy = true
  tags        = var.tags

  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

# Core Case proxy: unauthenticated HTTPS front door for the SPA.
# Core Case still owns login, MFA, refresh, and bearer-token authorization.
resource "aws_apigatewayv2_integration" "core_case_proxy" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_method     = "ANY"
  integration_type       = "HTTP_PROXY"
  integration_uri        = "${var.core_case_public_base_url}/v1/{proxy}"
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "core_case_v1_root" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_method     = "ANY"
  integration_type       = "HTTP_PROXY"
  integration_uri        = "${var.core_case_public_base_url}/v1"
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "core_case_proxy" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.core_case_proxy.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "core_case_v1_root" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "ANY /"
  target             = "integrations/${aws_apigatewayv2_integration.core_case_v1_root.id}"
  authorization_type = "NONE"
}

# Claims-probe Lambda: GET /auth-context (protected).
# Confirms the shared JWT authorizer forwards verified tenant/role claims.

resource "aws_cloudwatch_log_group" "claims_probe" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = "/aws/lambda/${var.name_prefix}-claims-probe"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "claims_probe" {
  name                 = "${var.name_prefix}-claims-probe-lambda-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "claims_probe_basic_execution" {
  role       = aws_iam_role.claims_probe.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "claims_probe_xray" {
  role       = aws_iam_role.claims_probe.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_lambda_function" "claims_probe" {
  #checkov:skip=CKV_AWS_116: This function is a synchronous API Gateway integration; failures return an error response to the caller rather than needing a Lambda DLQ, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_272: Lambda code-signing requires a signing profile and code-signing config not yet provisioned for sandbox; deployment package integrity is otherwise covered by source_code_hash, owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_117: This function only verifies JWT claims already validated by the API Gateway authorizer and calls no VPC-private resources (no database/Redis access), so it intentionally runs outside the VPC, owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_115: Reserved concurrency is deferred until sandbox traffic patterns justify a specific limit; setting one prematurely risks throttling without capacity data, owner platform-security, review by 2026-11-22
  function_name    = "${var.name_prefix}-claims-probe"
  role             = aws_iam_role.claims_probe.arn
  handler          = "claimsProbe.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  memory_size      = var.claims_probe_memory_size
  timeout          = var.claims_probe_timeout_seconds
  filename         = data.archive_file.claims_probe.output_path
  source_code_hash = data.archive_file.claims_probe.output_base64sha256
  tags             = var.tags

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_iam_role_policy_attachment.claims_probe_basic_execution,
    aws_cloudwatch_log_group.claims_probe,
  ]
}

resource "aws_apigatewayv2_integration" "claims_probe" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.claims_probe.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "claims_probe" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "GET /auth-context"
  target             = "integrations/${aws_apigatewayv2_integration.claims_probe.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.shared_jwt.id
}

resource "aws_lambda_permission" "claims_probe" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.claims_probe.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/GET/auth-context"
}

# Issue Payment Lambda: POST /expense-reports/{id}/settlement (protected).
# This is the API Gateway payment path: forwards the trusted internal
# settlement command to Core Case's internal route.

resource "aws_cloudwatch_log_group" "issue_payment" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = "/aws/lambda/${var.name_prefix}-issue-payment"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_security_group" "issue_payment" {
  count = local.vpc_config_enabled ? 1 : 0

  name        = "${var.name_prefix}-issue-payment-lambda-sg"
  description = "Controls traffic from the Issue Payment Lambda."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-issue-payment-lambda-sg"
  })
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr Issue Payment Lambda needs outbound access to Core Case and AWS APIs (Secrets Manager, CloudWatch Logs) in sandbox, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "issue_payment_all" {
  count = local.vpc_config_enabled ? 1 : 0

  #checkov:skip=CKV_AWS_382: Issue Payment Lambda needs outbound access to Core Case and AWS APIs (Secrets Manager, CloudWatch Logs) in sandbox, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.issue_payment[0].id
  description       = "Allow Issue Payment Lambda outbound access to Core Case and AWS APIs."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_iam_role" "issue_payment" {
  name                 = "${var.name_prefix}-issue-payment-lambda-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "issue_payment" {
  statement {
    sid       = "AllowLogging"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.issue_payment.arn}:*"]
  }

  statement {
    sid       = "AllowXRayTracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  statement {
    sid       = "AllowReadInternalCommandTokenSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.core_case_internal_command_token_secret_arn]
  }

  dynamic "statement" {
    for_each = local.vpc_config_enabled ? [1] : []

    content {
      sid = "AllowManageLambdaNetworkInterfaces"
      actions = [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses",
      ]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "issue_payment" {
  name   = "${var.name_prefix}-issue-payment-runtime"
  policy = data.aws_iam_policy_document.issue_payment.json
  role   = aws_iam_role.issue_payment.id
}

resource "aws_lambda_function" "issue_payment" {
  #checkov:skip=CKV_AWS_116: This function is a synchronous API Gateway integration; failures return an error response to the caller rather than needing a Lambda DLQ, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_272: Lambda code-signing requires a signing profile and code-signing config not yet provisioned for sandbox; deployment package integrity is otherwise covered by source_code_hash, owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_115: Reserved concurrency is deferred until sandbox traffic patterns justify a specific limit; setting one prematurely risks throttling without capacity data, owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_173: Environment variables are a base URL, a Secrets Manager ARN, and a timeout value, none of which are secret material; the actual command token is fetched at runtime via secretsmanager:GetSecretValue, owner platform-security, review by 2026-11-22
  function_name    = "${var.name_prefix}-issue-payment"
  role             = aws_iam_role.issue_payment.arn
  handler          = "issuePaymentStub.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  memory_size      = var.issue_payment_memory_size
  timeout          = var.issue_payment_timeout_seconds
  filename         = data.archive_file.issue_payment.output_path
  source_code_hash = data.archive_file.issue_payment.output_base64sha256
  tags             = var.tags

  environment {
    variables = {
      CORE_CASE_INTERNAL_BASE_URL                 = var.core_case_internal_base_url
      CORE_CASE_INTERNAL_COMMAND_TOKEN_SECRET_ARN = var.core_case_internal_command_token_secret_arn
      CORE_CASE_INTERNAL_TIMEOUT_MS               = tostring(var.core_case_internal_timeout_ms)
    }
  }

  tracing_config {
    mode = "Active"
  }

  dynamic "vpc_config" {
    for_each = local.vpc_config_enabled ? [1] : []

    content {
      security_group_ids = [aws_security_group.issue_payment[0].id]
      subnet_ids         = var.private_subnet_ids
    }
  }

  depends_on = [
    aws_iam_role_policy.issue_payment,
    aws_cloudwatch_log_group.issue_payment,
  ]
}

resource "aws_apigatewayv2_integration" "issue_payment" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.issue_payment.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "issue_payment" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "POST /expense-reports/{id}/settlement"
  target             = "integrations/${aws_apigatewayv2_integration.issue_payment.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.shared_jwt.id
}

resource "aws_lambda_permission" "issue_payment" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.issue_payment.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/POST/expense-reports/*/settlement"
}
