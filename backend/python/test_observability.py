import json

from opentelemetry.trace import TraceFlags

from backend.python.observability import log_metric
from backend.python.observability import (
    _parse_xray_trace_header,
    _span_context_from_xray_header,
)


def test_log_metric_emits_sandbox_scoped_json(caplog):
    with caplog.at_level("INFO"):
        log_metric(
            service="gl-coding-service",
            event_type="gl_coding_request",
            metric_name="GlCodingRequestCount",
            tenant_id="40000000-0000-4000-8000-000000000123",
            outcome="success",
            route="/gl-coding/line-items",
        )

    record = next(
        message for message in caplog.messages if "GlCodingRequestCount" in message
    )
    payload = json.loads(record)

    assert payload == {
        "environment": "sandbox",
        "eventType": "gl_coding_request",
        "metricName": "GlCodingRequestCount",
        "metricValue": 1,
        "outcome": "success",
        "route": "/gl-coding/line-items",
        "service": "gl-coding-service",
        "tenantId": "40000000-0000-4000-8000-000000000123",
    }


def test_log_metric_can_carry_trace_context(caplog):
    with caplog.at_level("INFO"):
        log_metric(
            service="gl-coding-service",
            event_type="http_request",
            metric_name="HttpRequestCount",
            tenant_id="40000000-0000-4000-8000-000000000123",
            outcome="success",
            trace_id="11111111111111111111111111111111",
            correlation_id="70000000-0000-4000-8000-000000000123",
        )

    record = next(
        message for message in caplog.messages if "HttpRequestCount" in message
    )
    payload = json.loads(record)

    assert payload["traceId"] == "11111111111111111111111111111111"
    assert payload["correlationId"] == "70000000-0000-4000-8000-000000000123"


def test_parse_xray_trace_header_reads_valid_aws_headers():
    header = (
        "Root=1-5759e988-bd862e3fe1be46a994272793;"
        "Parent=53995c3f42cd8ad8;Sampled=1"
    )

    assert _parse_xray_trace_header(header) == {
        "parent_span_id": "53995c3f42cd8ad8",
        "sampled": True,
        "trace_id": "5759e988bd862e3fe1be46a994272793",
    }


def test_span_context_from_xray_header_uses_root_only_headers():
    header = "Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=0;Lineage=1:2"

    span_context = _span_context_from_xray_header(header)

    assert span_context is not None
    assert f"{span_context.trace_id:032x}" == "5759e988bd862e3fe1be46a994272793"
    assert f"{span_context.span_id:016x}" != "0000000000000000"
    assert span_context.trace_flags == TraceFlags.DEFAULT


def test_malformed_xray_headers_return_no_parent_context():
    assert _parse_xray_trace_header("Root=broken;Parent=53995c3f42cd8ad8") is None
    assert _span_context_from_xray_header("Root=broken") is None
