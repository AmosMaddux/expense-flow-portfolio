locals {
  namespace                         = "ExpenseFlow/${var.name_prefix}"
  core_case_service_name            = "core-case-service"
  gl_coding_service_name            = "gl-coding-service"
  stage_transition_consumer_name    = "stage-transition-consumer-lambda"
  activity_feed_query               = <<-EOT
    SOURCE '${var.core_case_log_group_name}' | SOURCE '${var.gl_coding_log_group_name}' | SOURCE '${var.stage_transition_lambda_log_group_name}'
    | fields @timestamp, service, eventType, metricName, tenantId, route, outcome, toStage, statusCode, errorName
    | filter ispresent(eventType)
    | sort @timestamp desc
    | limit 50
  EOT
  stage_transition_error_rate_query = <<-EOT
    SOURCE '${var.core_case_log_group_name}'
    | fields tenantId, metricName, eventType
    | filter eventType = "stage_transition"
    | stats count() as attempts, sum(if(metricName = "StageTransitionErrorCount", 1, 0)) as errors by tenantId
    | display tenantId, attempts, errors, round(100 * errors / attempts, 2) as errorRate
    | sort errorRate desc
    | limit 20
  EOT
  alert_disposition_query           = <<-EOT
    SOURCE '${var.core_case_log_group_name}'
    | fields @timestamp, tenantId, alertId, alertName, severity, status, correlationId, traceId, investigatedBy
    | filter eventType = "alert_disposition"
    | sort @timestamp desc
    | limit 25
  EOT
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

resource "aws_cloudwatch_log_metric_filter" "stage_transition_consumer_success" {
  name           = "${var.name_prefix}-stage-transition-consumer-success"
  log_group_name = var.stage_transition_lambda_log_group_name
  pattern        = "{ $.metricName = \"StageTransitionConsumerSuccessCount\" }"

  metric_transformation {
    name      = "StageTransitionConsumerSuccessCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "stage_transition_consumer_error" {
  name           = "${var.name_prefix}-stage-transition-consumer-error"
  log_group_name = var.stage_transition_lambda_log_group_name
  pattern        = "{ $.metricName = \"StageTransitionConsumerErrorCount\" }"

  metric_transformation {
    name      = "StageTransitionConsumerErrorCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      TenantId = "$.tenantId"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "core_case_alert_disposition" {
  name           = "${var.name_prefix}-core-case-alert-disposition"
  log_group_name = var.core_case_log_group_name
  pattern        = "{ $.metricName = \"AlertDispositionRecordedCount\" }"

  metric_transformation {
    name      = "AlertDispositionRecordedCount"
    namespace = local.namespace
    value     = "1"
    dimensions = {
      Service  = "$.service"
      Status   = "$.status"
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
          view   = "table"
          query  = local.activity_feed_query
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
          title  = "Stage Transition Throughput by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"StageTransitionSuccessCount\" AND Service=\"${local.core_case_service_name}\"', 'Sum')"
                id         = "stage_transition_throughput"
                label      = "Stage transition throughput by tenant"
                visible    = true
              },
            ],
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
          title  = "Stage Transition Errors by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"StageTransitionErrorCount\" AND Service=\"${local.core_case_service_name}\"', 'Sum')"
                id         = "stage_transition_errors"
                label      = "Stage transition errors by tenant"
                visible    = true
              },
            ],
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
          view   = "table"
          query  = local.stage_transition_error_rate_query
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "GL-coding Requests by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"GlCodingRequestCount\" AND Service=\"${local.gl_coding_service_name}\"', 'Sum')"
                id         = "gl_coding_requests"
                label      = "GL-coding requests by tenant"
                visible    = true
              },
            ],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "GL-coding Errors by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"GlCodingErrorCount\" AND Service=\"${local.gl_coding_service_name}\"', 'Sum')"
                id         = "gl_coding_errors"
                label      = "GL-coding errors by tenant"
                visible    = true
              },
            ],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 24
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "Stage-Transition Consumer Success by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"StageTransitionConsumerSuccessCount\" AND Service=\"${local.stage_transition_consumer_name}\"', 'Sum')"
                id         = "stage_transition_consumer_success"
                label      = "Stage-transition consumer success by tenant"
                visible    = true
              },
            ],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 24
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "Stage-Transition Consumer Errors by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service} MetricName=\"StageTransitionConsumerErrorCount\" AND Service=\"${local.stage_transition_consumer_name}\"', 'Sum')"
                id         = "stage_transition_consumer_errors"
                label      = "Stage-transition consumer errors by tenant"
                visible    = true
              },
            ],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 30
        width  = 12
        height = 6
        properties = {
          view   = "timeSeries"
          region = var.aws_region
          title  = "Alert Dispositions by Tenant"
          period = 300
          metrics = [
            [
              {
                expression = "SEARCH('{\"${local.namespace}\",TenantId,Service,Status} MetricName=\"AlertDispositionRecordedCount\" AND Service=\"${local.core_case_service_name}\"', 'Sum')"
                id         = "alert_disposition_count"
                label      = "Alert dispositions by tenant"
                visible    = true
              },
            ],
          ]
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 30
        width  = 12
        height = 6
        properties = {
          region = var.aws_region
          title  = "Alert Disposition Log Entries"
          view   = "table"
          query  = local.alert_disposition_query
        }
      },
    ]
  })
}
