from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from backend.python.domain_exceptions import (
    MalformedCurrencyError,
    NegativeAmountError,
)


# Decimal keeps currency threshold checks aligned with exact reimbursement amounts.
LINE_ITEM_FLAG_THRESHOLD = Decimal("500.00")


class ExpenseLineItem(BaseModel):
    """Represent a single expense line item with MVP flagging rules."""

    amount: Decimal
    currency: str = Field(..., min_length=3, max_length=3)

    @property
    def is_flagged(self) -> bool:
        """Return whether the line item crosses the manual review threshold."""
        return self.amount > LINE_ITEM_FLAG_THRESHOLD

    @field_validator("amount")
    @classmethod
    def validate_non_negative(cls, value: Decimal) -> Decimal:
        """Reject negative amounts before a line item enters review."""
        if value < 0:
            raise NegativeAmountError(value)
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def validate_currency_format(cls, value: str) -> str:
        """Require ISO-style uppercase currency codes for consistent AP coding."""
        if not isinstance(value, str):
            raise MalformedCurrencyError(value)

        if len(value) != 3 or not value.isupper() or not value.isalpha():
            raise MalformedCurrencyError(value)

        return value


def flag_over_threshold_line_items(
    line_items: list[ExpenseLineItem],
) -> list[ExpenseLineItem]:
    """Select line items that need manual review under the MVP threshold rule."""
    return [line_item for line_item in line_items if line_item.is_flagged]
