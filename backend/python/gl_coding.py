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


class GlMappingStatus(StrEnum):
    """Classify whether a request item resolved to a GL account."""

    MAPPED = "mapped"
    UNMAPPED = "unmapped"


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
    mapping_status: GlMappingStatus = GlMappingStatus.MAPPED
    gl_account: GlAccount | None
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


# The MVP lookup is intentionally static until tenant-managed GL mappings exist.
GL_MAPPING_LOOKUP: dict[ExpenseCategory, GlAccount] = {
    ExpenseCategory.TRAVEL: GlAccount(
        account_code="6100",
        account_name="Travel Expense",
    ),
    ExpenseCategory.MEALS: GlAccount(
        account_code="6200",
        account_name="Meals Expense",
    ),
    ExpenseCategory.LODGING: GlAccount(
        account_code="6300",
        account_name="Lodging Expense",
    ),
    ExpenseCategory.MILEAGE: GlAccount(
        account_code="6400",
        account_name="Mileage Reimbursement",
    ),
    ExpenseCategory.OFFICE_SUPPLIES: GlAccount(
        account_code="6500",
        account_name="Office Supplies Expense",
    ),
    ExpenseCategory.SOFTWARE: GlAccount(
        account_code="6600",
        account_name="Software Expense",
    ),
}


def code_line_items_to_gl_accounts(
    request: GlCodingComputeRequest,
) -> GlCodingComputeResponse:
    """Return GL account mappings and review flags for submitted expense items."""
    coded_items = [
        code_line_item_to_gl_account(line_item) for line_item in request.line_items
    ]
    flags = [
        GlCodingFlag(
            source_id=line_item.line_item_id,
            source_type=GlSourceType.LINE_ITEM,
            code=GlCodingFlagCode.LINE_ITEM_OVER_THRESHOLD,
            message="Line item amount is above the MVP manual review threshold.",
        )
        for line_item in request.line_items
        if is_line_item_over_threshold(line_item.amount)
    ]

    return GlCodingComputeResponse(coded_items=coded_items, flags=flags)


def code_line_item_to_gl_account(line_item: GlCodingLineItemRequest) -> GlCodedItem:
    """Return the mapped or explicitly unmapped GL coding result for one item."""
    gl_account = GL_MAPPING_LOOKUP.get(line_item.category)
    mapping_status = (
        GlMappingStatus.MAPPED
        if gl_account is not None
        else GlMappingStatus.UNMAPPED
    )

    return GlCodedItem(
        source_id=line_item.line_item_id,
        source_type=GlSourceType.LINE_ITEM,
        category=line_item.category,
        mapping_status=mapping_status,
        gl_account=gl_account,
        amount=line_item.amount,
        currency=line_item.currency,
        flagged_line_item=is_line_item_over_threshold(line_item.amount),
    )


def is_line_item_over_threshold(amount: Decimal) -> bool:
    """Return whether a line item crosses the MVP manual review threshold."""
    return amount > Decimal("500.00")
