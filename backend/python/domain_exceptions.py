from decimal import Decimal
from typing import Any


class NegativeAmountError(ValueError):
    def __init__(self, amount: Decimal) -> None:
        super().__init__(f"Expense amount cannot be negative. Got: {amount}")


class MalformedCurrencyError(ValueError):
    def __init__(self, currency: Any) -> None:
        super().__init__(
            f"Currency must be exactly 3 uppercase letters. Got: {str(currency)}"
        )