from decimal import Decimal
from uuid import UUID

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from backend.python.auth import AuthenticatedRequestContext, require_request_context
from backend.python.gl_coding import (
    ExpenseCategory,
    GlAccount,
    GlCodingComputeRequest,
    GlMappingStatus,
    code_line_items_to_gl_accounts,
)
from backend.python.main import app, get_gl_account_mapping_repository

TENANT_ID = UUID("40000000-0000-4000-8000-000000000300")


class FakeGlAccountMappingRepository:
    """Return synthetic tenant-scoped GL mappings for endpoint tests."""

    def __init__(
        self, accounts_by_category: dict[ExpenseCategory, GlAccount] | None = None
    ) -> None:
        self.accounts_by_category = accounts_by_category or {}
        self.requests: list[tuple[UUID, set[ExpenseCategory]]] = []

    async def get_accounts_for_categories(
        self, tenant_id: UUID, categories: set[ExpenseCategory]
    ) -> dict[ExpenseCategory, GlAccount]:
        """Return only requested accounts to mimic the repository contract."""
        self.requests.append((tenant_id, categories))
        return {
            category: account
            for category, account in self.accounts_by_category.items()
            if category in categories
        }


SEEDED_GL_ACCOUNTS = {
    ExpenseCategory.TRAVEL: GlAccount(
        account_code="6000",
        account_name="Travel Expense",
    ),
    ExpenseCategory.MEALS: GlAccount(
        account_code="6100",
        account_name="Meals Expense",
    ),
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
}


def gl_coding_payload() -> dict[str, object]:
    """Return synthetic line items for GL-coding endpoint coverage."""
    return {
        "line_items": [
            {
                "line_item_id": "30000000-0000-4000-8000-000000000101",
                "merchant": "Example Air",
                "amount": "501.00",
                "currency": "USD",
                "category": "Travel",
            },
            {
                "line_item_id": "30000000-0000-4000-8000-000000000102",
                "merchant": "Example Vendor",
                "amount": "42.50",
                "currency": "USD",
                "category": "Other",
            },
        ],
        "mileage": [],
    }


@pytest.mark.anyio
async def test_code_line_items_uses_seeded_tenant_mapping_and_marks_missing_category_unmapped() -> None:
    request = GlCodingComputeRequest.model_validate(gl_coding_payload())
    repository = FakeGlAccountMappingRepository(SEEDED_GL_ACCOUNTS)

    response = await code_line_items_to_gl_accounts(request, TENANT_ID, repository)

    mapped_item = response.coded_items[0]
    assert mapped_item.category is ExpenseCategory.TRAVEL
    assert mapped_item.mapping_status is GlMappingStatus.MAPPED
    assert mapped_item.gl_account is not None
    assert mapped_item.gl_account.account_code == "6000"
    assert mapped_item.gl_account.account_name == "Travel Expense"
    assert mapped_item.flagged_line_item is True

    unmapped_item = response.coded_items[1]
    assert unmapped_item.category is ExpenseCategory.OTHER
    assert unmapped_item.mapping_status is GlMappingStatus.UNMAPPED
    assert unmapped_item.gl_account is None
    assert unmapped_item.flagged_line_item is False
    assert repository.requests == [
        (TENANT_ID, {ExpenseCategory.TRAVEL, ExpenseCategory.OTHER})
    ]


@pytest.mark.anyio
async def test_gl_coding_endpoint_returns_mapped_and_unmapped_line_items() -> None:
    repository = FakeGlAccountMappingRepository(SEEDED_GL_ACCOUNTS)

    async def finance_admin_context() -> AuthenticatedRequestContext:
        return AuthenticatedRequestContext(
            tenant_id=TENANT_ID,
            role="Finance Admin",
            roles=["Finance Admin"],
        )

    app.dependency_overrides[require_request_context] = finance_admin_context
    app.dependency_overrides[get_gl_account_mapping_repository] = lambda: repository
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/gl-coding/line-items", json=gl_coding_payload()
            )
    finally:
        app.dependency_overrides.pop(require_request_context, None)
        app.dependency_overrides.pop(get_gl_account_mapping_repository, None)

    assert response.status_code == 200
    assert response.json() == {
        "coded_items": [
            {
                "source_id": "30000000-0000-4000-8000-000000000101",
                "source_type": "line_item",
                "category": "Travel",
                "mapping_status": "mapped",
                "gl_account": {
                    "account_code": "6000",
                    "account_name": "Travel Expense",
                },
                "amount": "501.00",
                "currency": "USD",
                "flagged_line_item": True,
            },
            {
                "source_id": "30000000-0000-4000-8000-000000000102",
                "source_type": "line_item",
                "category": "Other",
                "mapping_status": "unmapped",
                "gl_account": None,
                "amount": "42.50",
                "currency": "USD",
                "flagged_line_item": False,
            },
        ],
        "flags": [
            {
                "source_id": "30000000-0000-4000-8000-000000000101",
                "source_type": "line_item",
                "code": "line_item_over_threshold",
                "message": "Line item amount is above the MVP manual review threshold.",
            }
        ],
    }
    assert repository.requests == [
        (TENANT_ID, {ExpenseCategory.TRAVEL, ExpenseCategory.OTHER})
    ]


@pytest.mark.anyio
async def test_gl_coding_endpoint_rejects_missing_request_context() -> None:
    async def missing_context() -> AuthenticatedRequestContext:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    app.dependency_overrides[require_request_context] = missing_context
    app.dependency_overrides[get_gl_account_mapping_repository] = (
        FakeGlAccountMappingRepository
    )
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/gl-coding/line-items", json=gl_coding_payload()
            )
    finally:
        app.dependency_overrides.pop(require_request_context, None)
        app.dependency_overrides.pop(get_gl_account_mapping_repository, None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or missing bearer token."}


@pytest.mark.anyio
async def test_gl_coding_endpoint_rejects_employee_role() -> None:
    async def employee_context() -> AuthenticatedRequestContext:
        return AuthenticatedRequestContext(
            tenant_id=TENANT_ID,
            role="Employee",
            roles=["Employee"],
        )

    app.dependency_overrides[require_request_context] = employee_context
    app.dependency_overrides[get_gl_account_mapping_repository] = (
        FakeGlAccountMappingRepository
    )
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/gl-coding/line-items", json=gl_coding_payload()
            )
    finally:
        app.dependency_overrides.pop(require_request_context, None)
        app.dependency_overrides.pop(get_gl_account_mapping_repository, None)

    assert response.status_code == 403
    assert response.json() == {
        "detail": "AP Review GL coding requires Finance Admin or Department Manager."
    }


@pytest.mark.anyio
async def test_gl_coding_endpoint_payload_preserves_currency_amounts() -> None:
    request = GlCodingComputeRequest.model_validate(gl_coding_payload())
    repository = FakeGlAccountMappingRepository(SEEDED_GL_ACCOUNTS)

    response = await code_line_items_to_gl_accounts(request, TENANT_ID, repository)

    assert response.coded_items[0].amount == Decimal("501.00")
    assert response.coded_items[0].currency == "USD"
