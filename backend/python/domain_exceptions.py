from decimal import Decimal
from typing import Any


class NegativeAmountError(ValueError):
    """Report an expense amount that cannot enter reimbursement review."""

    def __init__(self, amount: Decimal) -> None:
        super().__init__(f"Expense amount cannot be negative. Got: {amount}")


class MalformedCurrencyError(ValueError):
    """Report a currency code that cannot be used for AP coding."""

    def __init__(self, currency: Any) -> None:
        super().__init__(
            f"Currency must be exactly 3 uppercase letters. Got: {str(currency)}"
        )


class UnknownExpenseCategoryError(ValueError):
    """Report an expense category that has no baseline GL mapping."""

    def __init__(self, category: Any) -> None:
        super().__init__(f"Expense category has no GL mapping. Got: {str(category)}")
