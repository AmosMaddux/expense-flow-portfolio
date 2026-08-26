locals {
  namespace = "ExpenseFlow/${var.name_prefix}"
}

resource "aws_cloudwatch_log_metric_filter" "core_case_http_request" {
  name           = "${var.name_prefix}-core-case-http-request"
  log_group_name = var.core_case_log_group_name
  pattern        = "{ $.metricName = \"HttpRequestCount\" }"

  metric_transformation {
    name      = "HttpRequestCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
      Route    = "$.route"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "core_case_http_error" {
  name           = "${var.name_prefix}-core-case-http-error"
  log_group_name = var.core_case_log_group_name
  pattern        = "{ $.metricName = \"HttpErrorCount\" }"

  metric_transformation {
    name      = "HttpErrorCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
      Route    = "$.route"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "core_case_stage_transition_success" {
  name           = "${var.name_prefix}-core-case-stage-transition-success"
  log_group_name = var.core_case_log_group_name
  pattern        = "{ $.metricName = \"StageTransitionSuccessCount\" }"

  metric_transformation {
    name      = "StageTransitionSuccessCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
      ToStage  = "$.toStage"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "core_case_stage_transition_error" {
  name           = "${var.name_prefix}-core-case-stage-transition-error"
  log_group_name = var.core_case_log_group_name
  pattern        = "{ $.metricName = \"StageTransitionErrorCount\" }"

  metric_transformation {
    name      = "StageTransitionErrorCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "gl_coding_request" {
  name           = "${var.name_prefix}-gl-coding-request"
  log_group_name = var.gl_coding_log_group_name
  pattern        = "{ $.metricName = \"GlCodingRequestCount\" }"

  metric_transformation {
    name      = "GlCodingRequestCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "gl_coding_error" {
  name           = "${var.name_prefix}-gl-coding-error"
  log_group_name = var.gl_coding_log_group_name
  pattern        = "{ $.metricName = \"GlCodingErrorCount\" }"

  metric_transformation {
    name      = "GlCodingErrorCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
    }
  }
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name_prefix}-observability"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "log"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          region = var.aws_region
          title  = "Application Activity Feed"
          query  = <<-EOT
            fields @timestamp, service, eventType, metricName, tenantId, route, outcome, toStage, statusCode
            | filter eventType in ["stage_transition", "http_request", "gl_coding_request", "service_startup"]
            | sort @timestamp desc
            | limit 50
          EOT
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "Stage Transition Throughput"
          stat   = "Sum"
          period = 300
          metrics = [
            [local.namespace, "StageTransitionSuccessCount", "Service", "core-case-service", "TenantId", "*", "ToStage", "*"],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "Stage Transition Errors"
          stat   = "Sum"
          period = 300
          metrics = [
            [local.namespace, "StageTransitionErrorCount", "Service", "core-case-service", "TenantId", "*"],
          ]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          region = var.aws_region
          title  = "Stage Transition Error Rate by Tenant"
          query  = <<-EOT
            fields tenantId, metricName, outcome
            | filter eventType = "stage_transition"
            | stats count() as attempts, sum(if(metricName = "StageTransitionErrorCount", 1, 0)) as errors by tenantId
            | display tenantId, attempts, errors, round(100 * errors / max(attempts, 1), 2) as errorRate
            | sort errorRate desc
            | limit 20
          EOT
        }
      }
    ]
  })
}
