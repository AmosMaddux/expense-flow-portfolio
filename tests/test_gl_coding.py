from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from backend.python.gl_coding import (
    ExpenseCategory,
    GlCodingComputeRequest,
    GlMappingStatus,
    code_line_items_to_gl_accounts,
)
from backend.python.main import app


def gl_coding_payload() -> dict[str, object]:
    """Return synthetic line items for GL-coding endpoint coverage."""
    return {
        "line_items": [
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "501.00",
                "currency": "USD",
                "category": "Travel",
            },
            {
                "line_item_id": "30000000-0000-4000-8000-000000000102",
                "merchant": "Example Vendor",
                "amount": "42.50",
                "currency": "USD",
                "category": "Other",
            },
        ],
        "mileage": [],
    }


def test_code_line_items_maps_known_category_and_marks_unmapped_category() -> None:
    request = GlCodingComputeRequest.model_validate(gl_coding_payload())

    response = code_line_items_to_gl_accounts(request)

    mapped_item = response.coded_items[0]
    assert mapped_item.category is ExpenseCategory.TRAVEL
    assert mapped_item.mapping_status is GlMappingStatus.MAPPED
    assert mapped_item.gl_account is not None
    assert mapped_item.gl_account.account_code == "6100"
    assert mapped_item.gl_account.account_name == "Travel Expense"
    assert mapped_item.flagged_line_item is True

    unmapped_item = response.coded_items[1]
    assert unmapped_item.category is ExpenseCategory.OTHER
    assert unmapped_item.mapping_status is GlMappingStatus.UNMAPPED
    assert unmapped_item.gl_account is None
    assert unmapped_item.flagged_line_item is False


@pytest.mark.anyio
async def test_gl_coding_endpoint_returns_mapped_and_unmapped_line_items() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/gl-coding/line-items", json=gl_coding_payload())

    assert response.status_code == 200
    assert response.json() == {
        "coded_items": [
            {
                "source_id": "30000000-0000-4000-8000-000000000101",
                "source_type": "line_item",
                "category": "Travel",
                "mapping_status": "mapped",
                "gl_account": {
                    "account_code": "6100",
                    "account_name": "Travel Expense",
                },
                "amount": "501.00",
                "currency": "USD",
                "flagged_line_item": True,
            },
            {
                "source_id": "30000000-0000-4000-8000-000000000102",
                "source_type": "line_item",
                "category": "Other",
                "mapping_status": "unmapped",
                "gl_account": None,
                "amount": "42.50",
                "currency": "USD",
                "flagged_line_item": False,
            },
        ],
        "flags": [
            {
                "source_id": "30000000-0000-4000-8000-000000000101",
                "source_type": "line_item",
                "code": "line_item_over_threshold",
                "message": "Line item amount is above the MVP manual review threshold.",
            }
        ],
    }


def test_gl_coding_endpoint_payload_preserves_currency_amounts() -> None:
    request = GlCodingComputeRequest.model_validate(gl_coding_payload())

    response = code_line_items_to_gl_accounts(request)

    assert response.coded_items[0].amount == Decimal("501.00")
    assert response.coded_items[0].currency == "USD"
