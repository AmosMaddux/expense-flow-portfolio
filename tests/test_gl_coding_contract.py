from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from backend.python.gl_coding import (
    ExpenseCategory,
    GlCodingComputeRequest,
    GlCodingComputeResponse,
    GlCodingLineItemRequest,
)
from backend.python.main import app


def valid_gl_coding_payload() -> dict[str, object]:
    """Return a synthetic request body for GL-coding contract tests."""
    return {
        "line_items": [
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "501.00",
                "currency": "USD",
                "category": "Travel",
            }
        ],
        "mileage": [
            {
                "mileage_entry_id": "30000000-0000-4000-8000-000000000201",
                "route": "Office to client site",
                "distance": "18.50",
                "mileage_date": "2026-07-16",
            }
        ],
    }


def test_gl_coding_request_model_accepts_line_items_and_mileage() -> None:
    request = GlCodingComputeRequest.model_validate(valid_gl_coding_payload())

    assert request.line_items[0].amount == Decimal("501.00")
    assert request.line_items[0].category is ExpenseCategory.TRAVEL
    assert request.mileage[0].distance == Decimal("18.50")


def test_gl_coding_response_model_requires_flagged_line_item_field() -> None:
    with pytest.raises(ValidationError, match="flagged_line_item"):
        GlCodingComputeResponse.model_validate(
            {
                "coded_items": [
                    {
                        "source_id": "30000000-0000-4000-8000-000000000101",
                        "source_type": "line_item",
                        "category": "Travel",
                        "gl_account": {
                            "account_code": "6000",
                            "account_name": "Travel Expense",
                        },
                        "amount": "42.50",
                        "currency": "USD",
                    }
                ],
                "flags": [],
            }
        )


def test_gl_coding_request_rejects_negative_line_item_amount() -> None:
    with pytest.raises(ValidationError, match="Expense amount cannot be negative"):
        GlCodingLineItemRequest.model_validate(
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "-1.00",
                "currency": "USD",
                "category": "Travel",
            }
        )


def test_gl_coding_request_rejects_unknown_category() -> None:
    with pytest.raises(ValidationError, match="Expense category has no GL mapping"):
        GlCodingLineItemRequest.model_validate(
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "42.50",
                "currency": "USD",
                "category": "Training",
            }
        )


@pytest.mark.anyio
async def test_gl_coding_compute_returns_coded_items_flags_and_flagged_field() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post("/gl-coding/compute", json=valid_gl_coding_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["coded_items"][0]["gl_account"] == {
        "account_code": "6000",
        "account_name": "Travel Expense",
    }
    assert body["coded_items"][0]["flagged_line_item"] is True
    assert body["coded_items"][1]["source_type"] == "mileage"
    assert body["coded_items"][1]["flagged_line_item"] is False
    assert body["flags"] == [
        {
            "source_id": "30000000-0000-4000-8000-000000000101",
            "source_type": "line_item",
            "code": "line_item_over_threshold",
            "message": "Line item amount exceeds the manual review threshold.",
        }
    ]


@pytest.mark.anyio
async def test_gl_coding_compute_rejects_negative_amount_with_422() -> None:
    payload = valid_gl_coding_payload()
    line_items = payload["line_items"]
    assert isinstance(line_items, list)
    line_items[0]["amount"] = "-1.00"

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post("/gl-coding/compute", json=payload)

    assert response.status_code == 422


@pytest.mark.anyio
async def test_gl_coding_compute_rejects_unknown_category_with_422() -> None:
    payload = valid_gl_coding_payload()
    line_items = payload["line_items"]
    assert isinstance(line_items, list)
    line_items[0]["category"] = "Training"

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post("/gl-coding/compute", json=payload)

    assert response.status_code == 422
