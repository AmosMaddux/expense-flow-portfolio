import asyncio
from types import SimpleNamespace
from uuid import UUID

from backend.python.auth import AuthenticatedIdentity, require_request_context


def test_require_request_context_stashes_tenant_on_request_state() -> None:
    request = SimpleNamespace(state=SimpleNamespace())
    identity = AuthenticatedIdentity.model_validate(
        {
            "sub": "40000000-0000-4000-8000-000000000501",
            "tenant_id": "40000000-0000-4000-8000-000000000502",
            "roles": ["Department Manager"],
            "iss": "expenseflow-core-case-service",
            "aud": "expenseflow-http-api",
            "iat": 1710000000,
            "exp": 1710000600,
            "token_use": "access",
        }
    )

    context = asyncio.run(require_request_context(request, identity))

    assert request.state.tenant_id == str(UUID("40000000-0000-4000-8000-000000000502"))
    assert context.tenant_id == UUID("40000000-0000-4000-8000-000000000502")
    assert context.role == "Department Manager"
