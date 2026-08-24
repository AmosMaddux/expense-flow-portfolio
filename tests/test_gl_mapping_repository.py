import os
from uuid import UUID

import pytest

from backend.python.gl_coding import ExpenseCategory
from backend.python.gl_mapping_repository import (
    GlMappingConfigurationError,
    PostgresGlAccountMappingRepository,
)

SEEDED_TENANT_ID = UUID("40000000-0000-4000-8000-000000000300")


def test_from_environment_prefers_database_url() -> None:
    repository = PostgresGlAccountMappingRepository.from_environment(
        {
            "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            "DB_HOST": "ignored-host",
        }
    )
    assert repository._connection_string == "postgresql://user:pass@localhost:5432/db"


def test_from_environment_assembles_connection_string_from_discrete_vars() -> None:
    repository = PostgresGlAccountMappingRepository.from_environment(
        {
            "DB_HOST": "db.internal",
            "DB_PORT": "5432",
            "DB_NAME": "expenseflow_core_case",
            "DB_USERNAME": "gl_coding_admin",
            "DB_PASSWORD": "p@ss/word",
        }
    )
    assert repository._connection_string == (
        "postgresql://gl_coding_admin:p%40ss%2Fword@db.internal:5432/expenseflow_core_case"
        "?sslmode=require"
    )


def test_from_environment_requires_some_database_configuration() -> None:
    with pytest.raises(GlMappingConfigurationError):
        PostgresGlAccountMappingRepository.from_environment({})


def test_from_environment_requires_all_discrete_vars_when_no_database_url() -> None:
    with pytest.raises(GlMappingConfigurationError):
        PostgresGlAccountMappingRepository.from_environment(
            {"DB_HOST": "db.internal", "DB_PORT": "5432"}
        )


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
