from decimal import Decimal

import pytest
from pydantic import ValidationError

from backend.python.gl_coding import (
    ExpenseCategory,
    GlCodingComputeRequest,
    GlCodingComputeResponse,
    GlCodingLineItemRequest,
)


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


def test_gl_coding_response_model_accepts_tenant_resolved_account() -> None:
    response = GlCodingComputeResponse.model_validate(
        {
            "coded_items": [
                {
                    "source_id": "30000000-0000-4000-8000-000000000101",
                    "source_type": "line_item",
                    "category": "Travel",
                    "gl_account": {
                        "account_code": "7777",
                        "account_name": "Tenant Travel Expense",
                    },
                    "amount": "42.50",
                    "currency": "USD",
                    "flagged_line_item": False,
                }
            ],
            "flags": [],
        }
    )

    assert response.coded_items[0].gl_account.account_code == "7777"


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


def test_gl_coding_request_rejects_category_outside_contract() -> None:
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


@pytest.mark.parametrize("category", [{}, []], ids=["object", "list"])
def test_gl_coding_request_rejects_non_string_category_shapes(
    category: object,
) -> None:
    with pytest.raises(ValidationError, match="Expense category has no GL mapping"):
        GlCodingLineItemRequest.model_validate(
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "42.50",
                "currency": "USD",
                "category": category,
            }
        )
