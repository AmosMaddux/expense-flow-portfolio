import json

from backend.python.observability import log_metric


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
