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
  function_name  = "${var.name_prefix}-stage-transition-consumer"
  log_group_name = "/aws/lambda/${local.function_name}"
}

# The application's lambdaDatabaseConfig.ts resolves a single Secrets Manager
# secret shaped {"database_url": "postgres://..."} via DATABASE_SECRET_ARN.
# The RDS-managed master user secret is shaped {"username", "password", ...}
# instead, so this derives a Lambda-specific secret from it. This is the
# minimal glue required for the existing application code to run; it does not
# change how ECS consumes the RDS-managed secret.
data "aws_secretsmanager_secret_version" "core_case_db_master_user" {
  secret_id = var.core_case_db_master_user_secret_arn
}

locals {
  core_case_db_master_user_credentials = jsondecode(data.aws_secretsmanager_secret_version.core_case_db_master_user.secret_string)
  core_case_database_url = format(
    "postgres://%s:%s@%s:%s/%s",
    urlencode(local.core_case_db_master_user_credentials.username),
    urlencode(local.core_case_db_master_user_credentials.password),
    var.core_case_db_host,
    var.core_case_db_port,
    var.core_case_db_name,
  )
}

resource "aws_secretsmanager_secret" "database_url" {
  #checkov:skip=CKV_AWS_149: Sandbox Secrets Manager uses the default AWS-managed KMS key while CMK ownership is reviewed separately, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_57: This secret is derived from the RDS-managed master user secret, which is not rotated by this module either; automatic rotation is deferred for sandbox pending a rotation Lambda that re-derives the connection string, owner platform-security, review by 2026-11-22
  name = "${var.name_prefix}-stage-transition-consumer-database-url"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = jsonencode({
    database_url = local.core_case_database_url
  })
}

resource "aws_ecr_repository" "this" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-stage-transition-consumer-lambda"
  image_tag_mutability = "IMMUTABLE"
  tags                 = var.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "this" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-stage-transition-consumer-lambda-sg"
  description = "Controls traffic from the stage-transition consumer Lambda."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-stage-transition-consumer-lambda-sg"
  })
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr Lambda needs outbound access to AWS APIs (Secrets Manager, SQS, CloudWatch Logs) and the database in sandbox, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "this_all" {
  #checkov:skip=CKV_AWS_382: Lambda needs outbound access to AWS APIs (Secrets Manager, SQS, CloudWatch Logs) and the database in sandbox, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.this.id
  description       = "Allow stage-transition consumer Lambda outbound access to AWS APIs and the database."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_iam_role" "this" {
  name                 = "${var.name_prefix}-stage-transition-consumer-lambda-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "this" {
  #checkov:skip=CKV_AWS_111: AllowManageLambdaNetworkInterfaces uses resource "*" because ec2:CreateNetworkInterface and related ENI actions do not support resource-level restriction for Lambda VPC attachment (AWS-documented constraint), owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_356: Same as CKV_AWS_111: the ec2:*NetworkInterface* actions required for Lambda VPC ENI management are not scopable to a specific resource ARN, owner platform-security, review by 2026-11-22
  statement {
    sid       = "AllowLogging"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }

  statement {
    sid = "AllowConsumeStageTransitionQueue"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [var.stage_transition_sqs_queue_arn]
  }

  statement {
    sid       = "AllowReadStageTransitionDlqAttributes"
    actions   = ["sqs:GetQueueAttributes"]
    resources = [var.stage_transition_sqs_dlq_arn]
  }

  statement {
    sid       = "AllowReadDatabaseUrlSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn]
  }

  statement {
    sid       = "AllowXRayTracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  statement {
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

resource "aws_iam_role_policy" "this" {
  name   = "${var.name_prefix}-stage-transition-consumer-runtime"
  policy = data.aws_iam_policy_document.this.json
  role   = aws_iam_role.this.id
}

resource "aws_lambda_function" "this" {
  #checkov:skip=CKV_AWS_116: Dead-letter handling is provided by the SQS event-source mapping's ReportBatchItemFailures and the queue's own redrive policy, not a Lambda DLQ target, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_173: Lambda environment variables here are non-sensitive (Secrets Manager ARN only); no secret values are stored in plain environment variables, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_272: Lambda code-signing requires a signing profile and code-signing config not yet provisioned for sandbox; this function deploys a container image whose provenance is separately covered by ECR image_scanning_configuration and IMMUTABLE tags, owner platform-security, review by 2026-11-22
  #checkov:skip=CKV_AWS_115: Reserved concurrency is deferred until sandbox traffic patterns justify a specific limit; setting one prematurely risks throttling this SQS consumer without capacity data, owner platform-security, review by 2026-11-22
  function_name = local.function_name
  role          = aws_iam_role.this.arn
  package_type  = "Image"
  image_uri     = coalesce(var.image_uri, "${aws_ecr_repository.this.repository_url}:latest")
  architectures = ["x86_64"]
  timeout       = var.timeout_seconds
  memory_size   = var.memory_size
  tags          = var.tags

  environment {
    variables = {
      DATABASE_SECRET_ARN = aws_secretsmanager_secret.database_url.arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  vpc_config {
    security_group_ids = [aws_security_group.this.id]
    subnet_ids         = var.private_subnet_ids
  }

  depends_on = [
    aws_iam_role_policy.this,
    aws_cloudwatch_log_group.this,
  ]
}

resource "aws_lambda_event_source_mapping" "stage_transition_events" {
  event_source_arn = var.stage_transition_sqs_queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = var.event_source_batch_size
  enabled          = var.event_source_mapping_enabled

  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.this]
}
