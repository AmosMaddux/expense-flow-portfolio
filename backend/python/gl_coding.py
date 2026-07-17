from datetime import date
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from backend.python.domain_exceptions import (
    MalformedCurrencyError,
    NegativeAmountError,
    UnknownExpenseCategoryError,
)


class ExpenseCategory(StrEnum):
    """List baseline expense categories accepted by the GL-coding contract."""

    TRAVEL = "Travel"
    MEALS = "Meals"
    LODGING = "Lodging"
    MILEAGE = "Mileage"
    OFFICE_SUPPLIES = "Office Supplies"
    SOFTWARE = "Software"
    OTHER = "Other"


class GlSourceType(StrEnum):
    """Identify the source record type for a coded GL response item."""

    LINE_ITEM = "line_item"
    MILEAGE = "mileage"


class GlCodingFlagCode(StrEnum):
    """Classify flags returned by the GL-coding contract."""

    LINE_ITEM_OVER_THRESHOLD = "line_item_over_threshold"


class GlAccount(BaseModel):
    """Represent the GL account selected for a request item."""

    account_code: str
    account_name: str


class GlCodingLineItemRequest(BaseModel):
    """Validate a single expense line item submitted for GL coding."""

    line_item_id: UUID
    merchant: str = Field(..., min_length=1)
    amount: Decimal = Field(..., max_digits=12, decimal_places=2)
    currency: str = Field(..., min_length=3, max_length=3)
    category: ExpenseCategory

    @field_validator("amount")
    @classmethod
    def validate_non_negative_amount(cls, value: Decimal) -> Decimal:
        """Reject negative reimbursement amounts before GL coding."""
        if value < 0:
            raise NegativeAmountError(value)
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def validate_currency_format(cls, value: str) -> str:
        """Require uppercase ISO-style currency codes for AP consistency."""
        if not isinstance(value, str):
            raise MalformedCurrencyError(value)

        if len(value) != 3 or not value.isupper() or not value.isalpha():
            raise MalformedCurrencyError(value)

        return value

    @field_validator("category", mode="before")
    @classmethod
    def validate_known_category(cls, value: str) -> str:
        """Reject categories that are outside the GL-coding request contract."""
        if not isinstance(value, str):
            raise UnknownExpenseCategoryError(value)

        if value not in {category.value for category in ExpenseCategory}:
            raise UnknownExpenseCategoryError(value)

        return value


class GlCodingMileageRequest(BaseModel):
    """Validate a mileage entry submitted for GL coding."""

    mileage_entry_id: UUID
    route: str = Field(..., min_length=1)
    distance: Decimal = Field(..., max_digits=8, decimal_places=2, gt=0)
    mileage_date: date


class GlCodingComputeRequest(BaseModel):
    """Define the request body accepted by the GL-coding compute endpoint."""

    line_items: list[GlCodingLineItemRequest] = Field(default_factory=list)
    mileage: list[GlCodingMileageRequest] = Field(default_factory=list)


class GlCodedItem(BaseModel):
    """Represent an item with its computed GL account selection."""

    source_id: UUID
    source_type: GlSourceType
    category: ExpenseCategory
    gl_account: GlAccount
    amount: Decimal | None = None
    currency: str | None = None
    flagged_line_item: bool


class GlCodingFlag(BaseModel):
    """Describe a GL-coding flag that needs downstream review."""

    source_id: UUID
    source_type: GlSourceType
    code: GlCodingFlagCode
    message: str


class GlCodingComputeResponse(BaseModel):
    """Define the response body returned by the GL-coding compute endpoint."""

    coded_items: list[GlCodedItem]
    flags: list[GlCodingFlag]
