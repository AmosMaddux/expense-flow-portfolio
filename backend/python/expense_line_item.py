from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from backend.python.domain_exceptions import (
    MalformedCurrencyError,
    NegativeAmountError,
)


class ExpenseLineItem(BaseModel):
    amount: Decimal
    currency: str = Field(..., min_length=3, max_length=3)

    @field_validator("amount")
    @classmethod
    def validate_non_negative(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise NegativeAmountError(value)
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def validate_currency_format(cls, value: str) -> str:
        if not isinstance(value, str):
            raise MalformedCurrencyError(value)

        if len(value) != 3 or not value.isupper() or not value.isalpha():
            raise MalformedCurrencyError(value)

        return value
