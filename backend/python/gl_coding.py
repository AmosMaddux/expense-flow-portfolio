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
from backend.python.expense_line_item import LINE_ITEM_FLAG_THRESHOLD


class ExpenseCategory(StrEnum):
    """List the baseline expense categories that can be mapped to GL codes."""

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


GL_ACCOUNTS_BY_CATEGORY: dict[ExpenseCategory, GlAccount] = {
    ExpenseCategory.TRAVEL: GlAccount(
        account_code="6000",
        account_name="Travel Expense",
    ),
    ExpenseCategory.MEALS: GlAccount(account_code="6100", account_name="Meals Expense"),
    ExpenseCategory.LODGING: GlAccount(
        account_code="6200",
        account_name="Lodging Expense",
    ),
    ExpenseCategory.MILEAGE: GlAccount(
        account_code="6300",
        account_name="Mileage Expense",
    ),
    ExpenseCategory.OFFICE_SUPPLIES: GlAccount(
        account_code="6400",
        account_name="Office Supplies Expense",
    ),
    ExpenseCategory.SOFTWARE: GlAccount(
        account_code="6500",
        account_name="Software Expense",
    ),
    ExpenseCategory.OTHER: GlAccount(account_code="6999", account_name="Other Expense"),
}


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
        """Reject categories that are not seeded in baseline GL mappings."""
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


def build_gl_coding_response(
    request: GlCodingComputeRequest,
) -> GlCodingComputeResponse:
    """Build a deterministic GL-coding response from the validated request."""
    coded_items: list[GlCodedItem] = []
    flags: list[GlCodingFlag] = []

    for line_item in request.line_items:
        is_flagged = line_item.amount > LINE_ITEM_FLAG_THRESHOLD
        coded_items.append(
            GlCodedItem(
                source_id=line_item.line_item_id,
                source_type=GlSourceType.LINE_ITEM,
                category=line_item.category,
                gl_account=GL_ACCOUNTS_BY_CATEGORY[line_item.category],
                amount=line_item.amount,
                currency=line_item.currency,
                flagged_line_item=is_flagged,
            )
        )

        if is_flagged:
            flags.append(
                GlCodingFlag(
                    source_id=line_item.line_item_id,
                    source_type=GlSourceType.LINE_ITEM,
                    code=GlCodingFlagCode.LINE_ITEM_OVER_THRESHOLD,
                    message="Line item amount exceeds the manual review threshold.",
                )
            )

    for mileage_entry in request.mileage:
        coded_items.append(
            GlCodedItem(
                source_id=mileage_entry.mileage_entry_id,
                source_type=GlSourceType.MILEAGE,
                category=ExpenseCategory.MILEAGE,
                gl_account=GL_ACCOUNTS_BY_CATEGORY[ExpenseCategory.MILEAGE],
                flagged_line_item=False,
            )
        )

    return GlCodingComputeResponse(coded_items=coded_items, flags=flags)
