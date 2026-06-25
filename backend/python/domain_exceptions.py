from decimal import Decimal


class NegativeAmountError(ValueError):
    def __init__(self, amount: Decimal) -> None:
        super().__init__(f"Expense amount cannot be negative. Got: {amount}")


class MalformedCurrencyError(ValueError):
    def __init__(self, currency: str) -> None:
        super().__init__(
            f"Currency must be exactly 3 uppercase letters. Got: {currency}"
        )
