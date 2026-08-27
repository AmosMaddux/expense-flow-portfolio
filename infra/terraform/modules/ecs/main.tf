data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      identifiers = ["ecs-tasks.amazonaws.com"]
      type        = "Service"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  core_case_log_group_name = "/ecs/${var.name_prefix}/core-case-service"
  gl_coding_log_group_name = "/ecs/${var.name_prefix}/gl-coding-service"
  otel_collector_log_group_name = "/ecs/${var.name_prefix}/otel-collector"
  otel_collector_config = <<-EOT
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      batch/traces:
        timeout: 1s
        send_batch_size: 50
      resourcedetection:
        detectors:
          - env
          - ecs
          - ec2
        override: false

    exporters:
      awsxray: {}

    extensions:
      health_check:
        endpoint: 0.0.0.0:13133

    service:
      extensions: [health_check]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [resourcedetection, batch/traces]
          exporters: [awsxray]
  EOT

  core_case_secret_arns = compact([
    var.core_case_auth_jwt_private_key_secret_arn,
    var.core_case_db_master_user_secret_arn,
    var.core_case_internal_command_token_secret_arn,
    var.core_case_mfa_totp_secret_encryption_key_secret_arn,
    var.core_case_redis_url_secret_arn,
    var.core_case_runtime_smoke_shared_secret_arn,
    var.core_case_tin_ein_validation_password_secret_arn,
    var.core_case_tin_ein_validation_username_secret_arn,
    var.gl_coding_internal_auth_secret_arn,
  ])

  gl_coding_secret_arns = compact([
    var.gl_coding_auth_jwt_public_keys_json_secret_arn,
    var.gl_coding_db_credentials_secret_arn,
  ])

  all_secret_arns = concat(local.core_case_secret_arns, local.gl_coding_secret_arns)

  core_case_secrets = concat(
    var.core_case_auth_jwt_private_key_secret_arn == null ? [] : [{ name = "AUTH_JWT_PRIVATE_KEY_BASE64", valueFrom = var.core_case_auth_jwt_private_key_secret_arn }],
    [
      { name = "DB_USERNAME", valueFrom = "${var.core_case_db_master_user_secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${var.core_case_db_master_user_secret_arn}:password::" },
    ],
    var.core_case_internal_command_token_secret_arn == null ? [] : [{ name = "CORE_CASE_INTERNAL_COMMAND_TOKEN", valueFrom = var.core_case_internal_command_token_secret_arn }],
    var.core_case_mfa_totp_secret_encryption_key_secret_arn == null ? [] : [{ name = "MFA_TOTP_SECRET_ENCRYPTION_KEY", valueFrom = var.core_case_mfa_totp_secret_encryption_key_secret_arn }],
    [{ name = "REDIS_URL", valueFrom = var.core_case_redis_url_secret_arn }],
    var.core_case_runtime_smoke_shared_secret_arn == null ? [] : [{ name = "RUNTIME_SMOKE_SHARED_SECRET", valueFrom = var.core_case_runtime_smoke_shared_secret_arn }],
    var.core_case_tin_ein_validation_password_secret_arn == null ? [] : [{ name = "TIN_EIN_VALIDATION_PASSWORD", valueFrom = var.core_case_tin_ein_validation_password_secret_arn }],
    var.core_case_tin_ein_validation_username_secret_arn == null ? [] : [{ name = "TIN_EIN_VALIDATION_USERNAME", valueFrom = var.core_case_tin_ein_validation_username_secret_arn }],
    var.gl_coding_internal_auth_secret_arn == null ? [] : [{ name = "GL_CODING_INTERNAL_AUTH_SECRET", valueFrom = var.gl_coding_internal_auth_secret_arn }],
  )

  gl_coding_secrets = concat(
    var.gl_coding_auth_jwt_public_keys_json_secret_arn == null ? [] : [{ name = "AUTH_JWT_JWKS_JSON", valueFrom = var.gl_coding_auth_jwt_public_keys_json_secret_arn }],
    [
      { name = "DB_USERNAME", valueFrom = "${var.gl_coding_db_credentials_secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${var.gl_coding_db_credentials_secret_arn}:password::" },
    ],
  )

  otel_collector_container_definition = {
    name      = "aws-otel-collector"
    image     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.30.0"
    essential = false
    portMappings = [
      { containerPort = 4317, hostPort = 4317, protocol = "tcp" },
      { containerPort = 4318, hostPort = 4318, protocol = "tcp" },
      { containerPort = 13133, hostPort = 13133, protocol = "tcp" },
    ]
    environment = [
      { name = "AWS_REGION", value = var.aws_region },
    ]
    secrets = [
      { name = "AOT_CONFIG_CONTENT", valueFrom = aws_ssm_parameter.otel_collector_config.name },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.otel_collector.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "aws-otel-collector"
      }
    }
  }
}

resource "aws_ecr_repository" "core_case" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-core-case-service"
  image_tag_mutability = "IMMUTABLE"
  tags                 = var.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "gl_coding" {
  #checkov:skip=CKV_AWS_136: Sandbox ECR uses AES256 while customer-managed KMS is reviewed separately, owner platform-security, review by 2026-12-31
  name                 = "${var.name_prefix}-gl-coding-service"
  image_tag_mutability = "IMMUTABLE"
  tags                 = var.tags

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "core_case" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = local.core_case_log_group_name
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "gl_coding" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = local.gl_coding_log_group_name
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "otel_collector" {
  #checkov:skip=CKV_AWS_158: CloudWatch KMS CMK is deferred until log key ownership is approved, owner platform-security, review by 2026-12-31
  name              = local.otel_collector_log_group_name
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_ssm_parameter" "otel_collector_config" {
  name      = "/${var.name_prefix}/otel-collector-config"
  type      = "String"
  tier      = "Standard"
  value     = local.otel_collector_config
  overwrite = true
  tags      = var.tags
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  tags = var.tags

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_s3_bucket" "receipts" {
  #checkov:skip=CKV_AWS_18: Receipt bucket access logging needs a dedicated log archive bucket outside SCRUM-154, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_144: Sandbox receipt cross-region replication is deferred until DR requirements are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV_AWS_145: Receipt bucket KMS CMK is deferred until key ownership and grants are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_61: Receipt lifecycle policy is deferred until finance retention requirements are approved, owner platform-security, review by 2026-12-31
  #checkov:skip=CKV2_AWS_62: Receipt event notifications are deferred until malware/audit ingestion is designed, owner platform-security, review by 2026-12-31
  bucket = var.receipt_storage_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_sns_topic" "stage_transitions" {
  name              = "${var.name_prefix}-stage-transitions"
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}

resource "aws_sqs_queue" "stage_transition_events_dlq" {
  name                      = "${var.name_prefix}-stage-transition-events-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "stage_transition_events" {
  name                       = "${var.name_prefix}-stage-transition-events"
  message_retention_seconds  = 1209600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 60
  tags                       = var.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.stage_transition_events_dlq.arn
    maxReceiveCount     = var.stage_transition_sqs_max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "stage_transition_events_dlq" {
  queue_url = aws_sqs_queue.stage_transition_events_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.stage_transition_events.arn]
  })
}

data "aws_iam_policy_document" "stage_transition_queue" {
  statement {
    sid     = "AllowExpenseFlowStageTransitionTopic"
    actions = ["sqs:SendMessage"]

    principals {
      identifiers = ["sns.amazonaws.com"]
      type        = "Service"
    }

    resources = [aws_sqs_queue.stage_transition_events.arn]

    condition {
      test     = "ArnEquals"
      values   = [aws_sns_topic.stage_transitions.arn]
      variable = "aws:SourceArn"
    }

    condition {
      test     = "StringEquals"
      values   = [data.aws_caller_identity.current.account_id]
      variable = "aws:SourceAccount"
    }
  }
}

resource "aws_sqs_queue_policy" "stage_transition_events" {
  queue_url = aws_sqs_queue.stage_transition_events.id
  policy    = data.aws_iam_policy_document.stage_transition_queue.json
}

resource "aws_sns_topic_subscription" "stage_transition_events" {
  topic_arn            = aws_sns_topic.stage_transitions.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.stage_transition_events.arn
  raw_message_delivery = true

  depends_on = [aws_sqs_queue_policy.stage_transition_events]
}

data "aws_iam_policy_document" "stage_transition_topic" {
  statement {
    sid = "AllowAccountTopicManagement"
    actions = [
      "sns:AddPermission",
      "sns:DeleteTopic",
      "sns:GetTopicAttributes",
      "sns:ListSubscriptionsByTopic",
      "sns:RemovePermission",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
    ]

    principals {
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
      type        = "AWS"
    }

    resources = [aws_sns_topic.stage_transitions.arn]
  }

  statement {
    sid       = "AllowCoreCaseStageTransitionPublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.stage_transitions.arn]

    principals {
      identifiers = [aws_iam_role.core_case_task.arn]
      type        = "AWS"
    }
  }
}

resource "aws_sns_topic_policy" "stage_transitions" {
  arn    = aws_sns_topic.stage_transitions.arn
  policy = data.aws_iam_policy_document.stage_transition_topic.json
}

resource "aws_dynamodb_table" "expense_report_projection" {
  #checkov:skip=CKV_AWS_119: Sandbox DynamoDB uses AWS-owned encryption while CMK ownership is reviewed separately, owner platform-security, review by 2026-12-31
  name         = var.dynamodb_expense_report_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tenantId"
  range_key    = "id"
  tags         = var.tags

  attribute {
    name = "tenantId"
    type = "S"
  }

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "currentStage"
    type = "S"
  }

  global_secondary_index {
    name               = var.dynamodb_expense_report_tenant_index_name
    non_key_attributes = ["dueDate"]
    projection_type    = "INCLUDE"

    key_schema {
      attribute_name = "tenantId"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "currentStage"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_iam_role" "execution" {
  name                 = "${var.name_prefix}-ecs-task-execution-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.all_secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-ecs-secrets"
  policy = data.aws_iam_policy_document.execution_secrets.json
  role   = aws_iam_role.execution.id
}

data "aws_iam_policy_document" "execution_telemetry" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [aws_ssm_parameter.otel_collector_config.arn]
  }
}

resource "aws_iam_role_policy" "execution_telemetry" {
  name   = "${var.name_prefix}-ecs-telemetry"
  policy = data.aws_iam_policy_document.execution_telemetry.json
  role   = aws_iam_role.execution.id
}

resource "aws_iam_role" "core_case_task" {
  name                 = "${var.name_prefix}-core-case-task-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role" "gl_coding_task" {
  name                 = "${var.name_prefix}-gl-coding-task-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  permissions_boundary = var.role_permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "core_case_runtime" {
  statement {
    sid = "EcsExec"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    # ECS Exec's SSM data channel APIs do not support resource-level scoping.
    resources = ["*"]
  }

  statement {
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.receipts.arn}/*"]
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.receipts.arn]
  }

  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.stage_transitions.arn]
  }

  statement {
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = [
      aws_dynamodb_table.expense_report_projection.arn,
      "${aws_dynamodb_table.expense_report_projection.arn}/index/${var.dynamodb_expense_report_tenant_index_name}",
    ]
  }
}

resource "aws_iam_role_policy" "core_case_runtime" {
  name   = "${var.name_prefix}-core-case-runtime"
  policy = data.aws_iam_policy_document.core_case_runtime.json
  role   = aws_iam_role.core_case_task.id
}

data "aws_iam_policy_document" "telemetry" {
  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [aws_ssm_parameter.otel_collector_config.arn]
  }

  statement {
    actions = [
      "xray:GetSamplingRules",
      "xray:GetSamplingStatisticSummaries",
      "xray:GetSamplingTargets",
      "xray:PutTelemetryRecords",
      "xray:PutTraceSegments",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "core_case_telemetry" {
  name   = "${var.name_prefix}-core-case-telemetry"
  policy = data.aws_iam_policy_document.telemetry.json
  role   = aws_iam_role.core_case_task.id
}

resource "aws_iam_role_policy" "gl_coding_telemetry" {
  name   = "${var.name_prefix}-gl-coding-telemetry"
  policy = data.aws_iam_policy_document.telemetry.json
  role   = aws_iam_role.gl_coding_task.id
}

resource "aws_security_group" "core_case" {
  name        = "${var.name_prefix}-core-case-task-sg"
  description = "Controls traffic to Core Case ECS tasks."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-core-case-task-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "core_case_from_public_alb" {
  security_group_id            = aws_security_group.core_case.id
  description                  = "Allow public ALB traffic to Core Case tasks."
  referenced_security_group_id = var.public_alb_security_group_id
  from_port                    = 3000
  ip_protocol                  = "tcp"
  to_port                      = 3000
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr Core Case needs outbound access to AWS APIs and validation endpoints in sandbox, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "core_case_all" {
  #checkov:skip=CKV_AWS_382: Core Case needs outbound access to AWS APIs and validation endpoints in sandbox, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.core_case.id
  description       = "Allow Core Case outbound access to AWS APIs and validation endpoints."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "core_case_from_internal_alb" {
  security_group_id            = aws_security_group.core_case.id
  description                  = "Allow internal ALB traffic to Core Case tasks."
  referenced_security_group_id = var.internal_alb_security_group_id
  from_port                    = 3000
  ip_protocol                  = "tcp"
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_core_case" {
  #checkov:skip=CKV_AWS_260: Internal ALB port 80 ingress is scoped to the Core Case security group, not public CIDR, owner platform-security, review by 2026-12-31
  security_group_id            = var.internal_alb_security_group_id
  description                  = "Allow Core Case traffic to the internal GL-coding ALB."
  referenced_security_group_id = aws_security_group.core_case.id
  from_port                    = 80
  ip_protocol                  = "tcp"
  to_port                      = 80
}

resource "aws_security_group" "gl_coding" {
  name        = "${var.name_prefix}-gl-coding-task-sg"
  description = "Controls traffic to GL-coding ECS tasks."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-gl-coding-task-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "gl_coding_from_internal_alb" {
  security_group_id            = aws_security_group.gl_coding.id
  description                  = "Allow internal ALB traffic to GL-coding tasks."
  referenced_security_group_id = var.internal_alb_security_group_id
  from_port                    = 8001
  ip_protocol                  = "tcp"
  to_port                      = 8001
}

#tfsec:ignore:aws-vpc-no-public-egress-sgr GL-coding needs outbound package and service access in sandbox, owner platform-security, review by 2026-12-31
resource "aws_vpc_security_group_egress_rule" "gl_coding_all" {
  #checkov:skip=CKV_AWS_382: GL-coding needs outbound package and service access in sandbox, owner platform-security, review by 2026-12-31
  security_group_id = aws_security_group.gl_coding.id
  description       = "Allow GL-coding outbound access to package and service endpoints."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_ecs_task_definition" "core_case" {
  family                   = "${var.name_prefix}-core-case-service"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.core_case_task.arn
  tags                     = var.tags

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    local.otel_collector_container_definition,
    {
      name      = "core-case-service"
      image     = coalesce(var.core_case_image_uri, "${aws_ecr_repository.core_case.repository_url}:latest")
      essential = true
      dependsOn = [{
        containerName = "aws-otel-collector"
        condition     = "START"
      }]
      portMappings = [{
        name          = "http"
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
        appProtocol   = "http"
      }]
      environment = [
        { name = "ARGON2_HASH_LENGTH", value = "32" },
        { name = "ARGON2_MEMORY_COST", value = "19456" },
        { name = "ARGON2_PARALLELISM", value = "1" },
        { name = "ARGON2_TIME_COST", value = "2" },
        { name = "AUTH_ACCESS_TOKEN_TTL_SECONDS", value = "900" },
        { name = "AUTH_JWT_ISSUER", value = var.auth_jwt_issuer },
        { name = "AUTH_JWT_KEY_ID", value = var.auth_jwt_key_id },
        { name = "AUTO_APPLY_MIGRATIONS", value = tostring(var.core_case_auto_apply_migrations) },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "CASE_QUEUE_ROLLUP_TTL_SECONDS", value = "30" },
        { name = "CORE_CASE_INTERNAL_ROUTES_ENABLED", value = tostring(var.core_case_internal_routes_enabled) },
        { name = "CORE_CASE_RATE_LIMIT_REQUESTS", value = "100" },
        { name = "CORE_CASE_RATE_LIMIT_WINDOW_SECONDS", value = "60" },
        { name = "DB_HOST", value = var.core_case_db_host },
        { name = "DB_NAME", value = var.core_case_db_name },
        { name = "DB_PORT", value = tostring(var.core_case_db_port) },
        { name = "DYNAMODB_EXPENSE_REPORT_TABLE", value = aws_dynamodb_table.expense_report_projection.name },
        { name = "DYNAMODB_EXPENSE_REPORT_TENANT_INDEX", value = var.dynamodb_expense_report_tenant_index_name },
        { name = "GL_CODING_BASE_BACKOFF_MS", value = "100" },
        { name = "GL_CODING_MAX_BACKOFF_MS", value = "1000" },
        { name = "GL_CODING_MAX_RETRIES", value = "2" },
        { name = "GL_CODING_SERVICE_BASE_URL", value = "http://${var.internal_alb_dns_name}" },
        { name = "GL_CODING_TIMEOUT_MS", value = "5000" },
        { name = "IDEMPOTENCY_STORE_BACKEND", value = "redis" },
        { name = "MFA_TOTP_SECRET_KEY_VERSION", value = var.mfa_totp_secret_key_version },
        { name = "MILEAGE_REIMBURSEMENT_RATE", value = "0.70" },
        { name = "OTEL_EXPORTER_OTLP_PROTOCOL", value = "http/protobuf" },
        { name = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", value = "http://127.0.0.1:4318/v1/traces" },
        { name = "PORT", value = "3000" },
        { name = "RECEIPT_STORAGE_BUCKET", value = aws_s3_bucket.receipts.bucket },
        { name = "RECEIPT_STORAGE_FORCE_PATH_STYLE", value = "false" },
        { name = "RUNTIME_SMOKE_GL_CODING_ENABLED", value = tostring(var.runtime_smoke_gl_coding_enabled) },
        { name = "SPA_ORIGIN", value = var.spa_origin },
        { name = "STAGE_TRANSITION_SNS_TOPIC_ARN", value = aws_sns_topic.stage_transitions.arn },
        { name = "TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE", value = "50" },
        { name = "TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS", value = "30000" },
        { name = "TIN_EIN_VALIDATION_ENDPOINT_URL", value = var.tin_ein_validation_endpoint_url },
        { name = "TIN_EIN_VALIDATION_OPERATION_NAME", value = "VerifyTaxpayer" },
        { name = "TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED", value = "true" },
        { name = "TIN_EIN_VALIDATION_STATUS_OPERATION_NAME", value = "GetTaxpayerStatus" },
        { name = "TIN_EIN_VALIDATION_TIMEOUT_MS", value = "5000" },
        { name = "TIN_EIN_VALIDATION_WSDL_URL", value = var.tin_ein_validation_wsdl_url },
      ]
      secrets = local.core_case_secrets
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));\""]
        interval    = 30
        timeout     = 3
        retries     = 3
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.core_case.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "core-case-service"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "gl_coding" {
  #checkov:skip=CKV_AWS_336: GL-coding container write paths need validation before enforcing a read-only root filesystem, owner platform-security, review by 2026-12-31
  family                   = "${var.name_prefix}-gl-coding-service"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.gl_coding_task.arn
  tags                     = var.tags

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    local.otel_collector_container_definition,
    {
      name      = "gl-coding-service"
      image     = coalesce(var.gl_coding_image_uri, "${aws_ecr_repository.gl_coding.repository_url}:latest")
      essential = true
      dependsOn = [{
        containerName = "aws-otel-collector"
        condition     = "START"
      }]
      portMappings = [{
        name          = "http"
        containerPort = 8001
        hostPort      = 8001
        protocol      = "tcp"
        appProtocol   = "http"
      }]
      environment = [
        { name = "AUTH_JWT_CLOCK_SKEW_SECONDS", value = "10" },
        { name = "AUTH_JWT_ISSUER", value = var.auth_jwt_issuer },
        { name = "AUTH_JWT_KEY_ID", value = var.auth_jwt_key_id },
        { name = "DB_HOST", value = var.gl_coding_db_host },
        { name = "DB_NAME", value = var.gl_coding_db_name },
        { name = "DB_PORT", value = tostring(var.gl_coding_db_port) },
        { name = "MILEAGE_REIMBURSEMENT_RATE", value = "0.70" },
        { name = "OTEL_EXPORTER_OTLP_PROTOCOL", value = "http/protobuf" },
        { name = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", value = "http://127.0.0.1:4318/v1/traces" },
      ]
      secrets = local.gl_coding_secrets
      healthCheck = {
        command     = ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2)"]
        interval    = 30
        timeout     = 3
        retries     = 3
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.gl_coding.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "gl-coding-service"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "core_case" {
  name                              = "${var.name_prefix}-core-case-service"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.core_case.arn
  desired_count                     = var.desired_count
  health_check_grace_period_seconds = 60
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  enable_ecs_managed_tags           = true
  enable_execute_command            = var.core_case_enable_execute_command
  tags                              = var.tags

  load_balancer {
    container_name   = "core-case-service"
    container_port   = 3000
    target_group_arn = var.core_case_target_group_arn
  }

  load_balancer {
    container_name   = "core-case-service"
    container_port   = 3000
    target_group_arn = var.core_case_internal_target_group_arn
  }

  network_configuration {
    assign_public_ip = var.assign_public_ip
    security_groups  = [aws_security_group.core_case.id]
    subnets          = var.service_subnet_ids
  }
}

resource "aws_ecs_service" "gl_coding" {
  name                              = "${var.name_prefix}-gl-coding-service"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.gl_coding.arn
  desired_count                     = var.desired_count
  health_check_grace_period_seconds = 60
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  enable_ecs_managed_tags           = true
  tags                              = var.tags

  load_balancer {
    container_name   = "gl-coding-service"
    container_port   = 8001
    target_group_arn = var.gl_coding_target_group_arn
  }

  network_configuration {
    assign_public_ip = var.assign_public_ip
    security_groups  = [aws_security_group.gl_coding.id]
    subnets          = var.service_subnet_ids
  }
}
