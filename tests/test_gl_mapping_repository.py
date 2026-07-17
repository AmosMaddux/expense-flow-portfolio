import os
from uuid import UUID

import pytest

from backend.python.gl_coding import ExpenseCategory
from backend.python.gl_mapping_repository import PostgresGlAccountMappingRepository

SEEDED_TENANT_ID = UUID("40000000-0000-4000-8000-000000000300")


@pytest.mark.anyio
async def test_postgres_repository_resolves_seeded_travel_mapping() -> None:
    connection_string = os.environ.get("DATABASE_URL")
    if connection_string is None:
        pytest.skip("DATABASE_URL is required for the seeded GL mapping smoke test.")

    from psycopg import OperationalError

    repository = PostgresGlAccountMappingRepository(connection_string)
    try:
        accounts = await repository.get_accounts_for_categories(
            SEEDED_TENANT_ID, {ExpenseCategory.TRAVEL}
        )
    except OperationalError as error:
        pytest.skip(f"Postgres is unavailable for the seeded GL mapping smoke test: {error}")

    travel_account = accounts[ExpenseCategory.TRAVEL]
    assert travel_account.account_code == "6000"
    assert travel_account.account_name == "Travel Expense"
