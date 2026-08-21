import os
from typing import Any, Mapping
from urllib.parse import quote
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
        """Create a repository from the process database configuration.

        Prefers DATABASE_URL (local/docker-compose) and otherwise assembles it
        from the discrete RDS connection env vars ECS injects.
        """
        env = environment if environment is not None else os.environ
        connection_string = env.get("DATABASE_URL")
        if connection_string is not None:
            return cls(connection_string)

        db_host = env.get("DB_HOST")
        db_port = env.get("DB_PORT")
        db_name = env.get("DB_NAME")
        db_username = env.get("DB_USERNAME")
        db_password = env.get("DB_PASSWORD")
        if not all([db_host, db_port, db_name, db_username, db_password]):
            raise GlMappingConfigurationError(
                "Database connection is not configured. Set DATABASE_URL, or "
                "DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD."
            )

        encoded_username = quote(db_username, safe="")
        encoded_password = quote(db_password, safe="")
        return cls(
            f"postgresql://{encoded_username}:{encoded_password}"
            f"@{db_host}:{db_port}/{db_name}?sslmode=require"
        )

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
