from decimal import Decimal

import pytest
from pydantic import ValidationError

from backend.python.expense_line_item import ExpenseLineItem


def test_expense_line_item_accepts_non_negative_amount_and_currency() -> None:
    line_item = ExpenseLineItem(amount="42.50", currency="USD")

    assert line_item.amount == Decimal("42.50")
    assert line_item.currency == "USD"


def test_expense_line_item_rejects_negative_amount() -> None:
    with pytest.raises(
        ValidationError, match="Expense amount cannot be negative. Got: -1.00"
    ):
        ExpenseLineItem(amount="-1.00", currency="USD")


@pytest.mark.parametrize("currency", ["usd", "US", "US3"])
def test_expense_line_item_rejects_malformed_currency(currency: str) -> None:
    with pytest.raises(
        ValidationError,
        match=f"Currency must be exactly 3 uppercase letters. Got: {currency}",
    ):
        ExpenseLineItem(amount="42.50", currency=currency)
