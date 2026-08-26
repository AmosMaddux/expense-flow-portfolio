import json
import logging
from time import perf_counter
from typing import Any

from fastapi import Request, Response

LOGGER_NAME = "expenseflow.python"

_logger = logging.getLogger(LOGGER_NAME)
_logger.setLevel(logging.INFO)


def _emit(event: dict[str, Any]) -> None:
    _logger.info(json.dumps(event, default=str, separators=(",", ":")))


def log_service_event(**event: Any) -> None:
    """Emit a structured service event for CloudWatch ingestion."""
    _emit(event)


def log_metric(
    *,
    service: str,
    event_type: str,
    metric_name: str,
    tenant_id: str,
    outcome: str,
    **details: Any,
) -> None:
    """Emit a structured CloudWatch metric event."""
    payload = {
        "environment": "sandbox",
        "eventType": event_type,
        "metricName": metric_name,
        "metricValue": 1,
        "outcome": outcome,
        "service": service,
        "tenantId": tenant_id,
        **details,
    }
    _emit(payload)


def request_metrics_middleware(service: str):
    """Create middleware that logs request throughput and 5xx errors."""

    async def middleware(request: Request, call_next):
        started_at = perf_counter()
        tenant_id = getattr(request.state, "tenant_id", "unknown")
        route = request.url.path
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((perf_counter() - started_at) * 1000, 2)
            log_metric(
                service=service,
                event_type="http_request",
                metric_name="HttpRequestCount",
                tenant_id=str(tenant_id),
                outcome="error",
                method=request.method,
                route=route,
                statusCode=500,
                durationMs=duration_ms,
            )
            log_metric(
                service=service,
                event_type="http_error",
                metric_name="HttpErrorCount",
                tenant_id=str(tenant_id),
                outcome="error",
                method=request.method,
                route=route,
                statusCode=500,
            )
            raise

        duration_ms = round((perf_counter() - started_at) * 1000, 2)
        log_metric(
            service=service,
            event_type="http_request",
            metric_name="HttpRequestCount",
            tenant_id=str(tenant_id),
            outcome="success" if response.status_code < 500 else "error",
            method=request.method,
            route=route,
            statusCode=response.status_code,
            durationMs=duration_ms,
        )
        if response.status_code >= 500:
            log_metric(
                service=service,
                event_type="http_error",
                metric_name="HttpErrorCount",
                tenant_id=str(tenant_id),
                outcome="error",
                method=request.method,
                route=route,
                statusCode=response.status_code,
            )
        return response

    return middleware
