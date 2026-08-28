import json
import logging
import os
import re
from time import perf_counter
from typing import Any
from uuid import uuid4

from fastapi import Request
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import (
    NonRecordingSpan,
    Span,
    SpanContext,
    SpanKind,
    TraceFlags,
    TraceState,
)

LOGGER_NAME = "expenseflow.python"

_xray_root_pattern = re.compile(r"^1-([0-9a-f]{8})-([0-9a-f]{24})$", re.IGNORECASE)
_xray_field_pattern = re.compile(r"(?:^|;)\s*([^=;]+)=([^;]+)")
_xray_span_id_pattern = re.compile(r"^[0-9a-f]{16}$", re.IGNORECASE)

_logger = logging.getLogger(LOGGER_NAME)
_logger.setLevel(logging.INFO)

_tracing_enabled = False
_tracer_provider_initialized = False


def _emit(event: dict[str, Any]) -> None:
    _logger.info(json.dumps(event, default=str, separators=(",", ":")))


def _parse_xray_trace_header(value: str | None) -> dict[str, str | bool] | None:
    if value is None or value.strip() == "":
        return None

    fields: dict[str, str] = {}
    for match in _xray_field_pattern.finditer(value):
        key = match.group(1).strip()
        raw_value = match.group(2).strip()
        if key and raw_value:
            fields[key] = raw_value

    root = fields.get("Root")
    if root is None:
        return None

    root_match = _xray_root_pattern.match(root)
    if root_match is None:
        return None

    parent_span_id = fields.get("Parent")
    return {
        "parent_span_id": parent_span_id.lower()
        if parent_span_id is not None
        and _xray_span_id_pattern.match(parent_span_id) is not None
        else "",
        "sampled": fields.get("Sampled") != "0",
        "trace_id": f"{root_match.group(1)}{root_match.group(2)}".lower(),
    }


def _span_context_from_xray_header(value: str | None) -> SpanContext | None:
    parsed = _parse_xray_trace_header(value)
    if parsed is None:
        return None

    span_id = parsed["parent_span_id"]
    if not isinstance(span_id, str) or span_id == "":
        span_id = uuid4().hex[:16]

    return SpanContext(
        trace_id=int(parsed["trace_id"], 16),
        span_id=int(span_id, 16),
        is_remote=True,
        trace_flags=TraceFlags.SAMPLED if parsed["sampled"] else TraceFlags.DEFAULT,
        trace_state=TraceState(),
    )


def _trace_id_from_span(span: Span | None) -> str:
    if span is None:
        return "unknown"

    span_context = span.get_span_context()
    if span_context.trace_id == 0:
        return "unknown"

    return f"{span_context.trace_id:032x}"


def initialize_tracing(service: str) -> None:
    """Initialize OTLP trace export if the collector endpoint is configured."""
    global _tracer_provider_initialized, _tracing_enabled

    if _tracer_provider_initialized:
        return

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    if endpoint == "":
        _tracer_provider_initialized = True
        return

    provider = TracerProvider(
        resource=Resource.create(
            {
                "deployment.environment.name": "sandbox",
                "service.name": service,
            }
        )
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint))
    )
    trace.set_tracer_provider(provider)
    _tracing_enabled = True
    _tracer_provider_initialized = True


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
    trace_id: str | None = None,
    correlation_id: str | None = None,
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
        **({"traceId": trace_id} if trace_id is not None else {}),
        **({"correlationId": correlation_id} if correlation_id is not None else {}),
        **details,
    }
    _emit(payload)


def request_tracing_middleware(service: str):
    """Create middleware that starts a server span from the X-Ray header."""
    initialize_tracing(service)
    tracer = trace.get_tracer(service)

    async def middleware(request: Request, call_next):
        trace_header = request.headers.get("x-amzn-trace-id")
        parent_context = _span_context_from_xray_header(trace_header)
        correlation_id = request.headers.get("x-correlation-id")
        span_name = f"{request.method} {request.url.path}"
        trace_context = (
            trace.set_span_in_context(NonRecordingSpan(parent_context))
            if parent_context is not None
            else None
        )

        with tracer.start_as_current_span(
            span_name,
            context=trace_context,
            kind=SpanKind.SERVER,
        ) as span:
            request.state.trace_id = _trace_id_from_span(span)
            request.state.correlation_id = correlation_id or "unknown"
            span.set_attribute("http.method", request.method)
            span.set_attribute("http.target", str(request.url))
            span.set_attribute("service.name", service)
            if correlation_id is not None:
                span.set_attribute("expenseflow.correlation_id", correlation_id)
            try:
                response = await call_next(request)
            except Exception as error:
                span.record_exception(error)
                span.set_attribute("http.status_code", 500)
                raise

            span.set_attribute("http.status_code", response.status_code)
            if correlation_id is not None:
                response.headers.setdefault("X-Correlation-Id", correlation_id)
            response.headers.setdefault("X-Trace-Id", request.state.trace_id)
            return response

    return middleware
def request_metrics_middleware(service: str):
    """Create middleware that logs request throughput and 5xx errors."""

    async def middleware(request: Request, call_next):
        started_at = perf_counter()
        tenant_id = getattr(request.state, "tenant_id", "unknown")
        route = request.url.path
        trace_id = getattr(request.state, "trace_id", None) or _trace_id_from_span(
            trace.get_current_span()
        )
        correlation_id = getattr(request.state, "correlation_id", None)
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
                trace_id=trace_id,
                correlation_id=correlation_id,
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
                trace_id=trace_id,
                correlation_id=correlation_id,
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
            trace_id=trace_id,
            correlation_id=correlation_id,
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
                trace_id=trace_id,
                correlation_id=correlation_id,
            )
        return response

    return middleware
