import os
from typing import Any, Mapping
from uuid import UUID

from .gl_coding import ExpenseCategory, GlAccount

GL_MAPPING_QUERY = """
    SELECT mapping.category, code.account_code, code.account_name
    FROM gl_mapping mapping
    INNER JOIN gl_code code
        ON code.tenant_id = mapping.tenant_id
        AND code.id = mapping.gl_code_id
    WHERE mapping.tenant_id = %s
        AND mapping.category = ANY(%s)
"""


class GlMappingConfigurationError(RuntimeError):
    """Report invalid GL mapping repository configuration."""


class PostgresGlAccountMappingRepository:
    """Resolve GL accounts from the tenant-managed Postgres reference tables."""

    def __init__(self, connection_string: str) -> None:
        if connection_string.strip() == "":
            raise GlMappingConfigurationError("DATABASE_URL cannot be blank.")
        self._connection_string = connection_string

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str] | None = None
    ) -> "PostgresGlAccountMappingRepository":
        """Create a repository from the process database configuration."""
        env = environment if environment is not None else os.environ
        connection_string = env.get("DATABASE_URL")
        if connection_string is None:
            raise GlMappingConfigurationError(
                "DATABASE_URL is required for GL mapping lookup."
            )
        return cls(connection_string)

    async def get_accounts_for_categories(
        self, tenant_id: UUID, categories: set[ExpenseCategory]
    ) -> dict[ExpenseCategory, GlAccount]:
        """Return tenant-scoped GL accounts keyed by expense category."""
        if len(categories) == 0:
            return {}

        from psycopg import AsyncConnection
        from psycopg.rows import dict_row

        category_values = [category.value for category in categories]
        async with await AsyncConnection.connect(
            self._connection_string,
            row_factory=dict_row,
        ) as connection:
            async with connection.cursor() as cursor:
                # Tenant ID must come from auth context so a request body cannot cross scopes.
                await cursor.execute(GL_MAPPING_QUERY, (tenant_id, category_values))
                rows = await cursor.fetchall()

        return {
            ExpenseCategory(row["category"]): GlAccount(
                account_code=row["account_code"],
                account_name=row["account_name"],
            )
            for row in rows
            if is_gl_mapping_row(row)
        }


def is_gl_mapping_row(row: Any) -> bool:
    """Return whether a database row has the expected GL mapping shape."""
    return (
        isinstance(row, dict)
        and isinstance(row.get("category"), str)
        and isinstance(row.get("account_code"), str)
        and isinstance(row.get("account_name"), str)
    )
