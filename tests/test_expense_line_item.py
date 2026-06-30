from decimal import Decimal

import pytest
from pydantic import ValidationError

from backend.python.expense_line_item import (
    ExpenseLineItem,
    flag_over_threshold_line_items,
)


def test_expense_line_item_accepts_non_negative_amount_and_currency() -> None:
    line_item = ExpenseLineItem(amount=Decimal("42.50"), currency="USD")

    assert line_item.amount == Decimal("42.50")
    assert line_item.currency == "USD"


def test_expense_line_item_flags_amounts_over_500_boundary() -> None:
    assert ExpenseLineItem(amount=Decimal("501.00"), currency="USD").is_flagged is True
    assert ExpenseLineItem(amount=Decimal("500.00"), currency="USD").is_flagged is False


def test_flag_over_threshold_line_items_returns_one_flag_per_over_threshold_item() -> None:
    line_items = [
        ExpenseLineItem(amount=Decimal("501.00"), currency="USD"),
        ExpenseLineItem(amount=Decimal("500.00"), currency="USD"),
        ExpenseLineItem(amount=Decimal("750.25"), currency="USD"),
    ]

    flagged_line_items = flag_over_threshold_line_items(line_items)

    assert flagged_line_items == [line_items[0], line_items[2]]


def test_flag_over_threshold_line_items_does_not_mutate_amounts() -> None:
    line_items = [
        ExpenseLineItem(amount=Decimal("501.00"), currency="USD"),
        ExpenseLineItem(amount=Decimal("500.00"), currency="USD"),
    ]
    original_amounts = [line_item.amount for line_item in line_items]

    flagged_line_items = flag_over_threshold_line_items(line_items)

    assert [line_item.amount for line_item in line_items] == original_amounts
    assert [line_item.amount for line_item in flagged_line_items] == [Decimal("501.00")]


def test_expense_line_item_rejects_negative_amount() -> None:
    with pytest.raises(
        ValidationError, match="Expense amount cannot be negative. Got: -1.00"
    ):
        ExpenseLineItem(amount=Decimal("-1.00"), currency="USD")


@pytest.mark.parametrize("currency", ["usd", "US", "US3"])
def test_expense_line_item_rejects_malformed_currency(currency: str) -> None:
    with pytest.raises(
        ValidationError,
        match=f"Currency must be exactly 3 uppercase letters. Got: {currency}",
    ):
        ExpenseLineItem(amount=Decimal("42.50"), currency=currency)
