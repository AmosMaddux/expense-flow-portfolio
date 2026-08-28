import socket
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID
from urllib.error import URLError
from urllib.request import urlopen

from fastapi import FastAPI
import pytest
import uvicorn

from backend.python.auth import AuthenticatedRequestContext, require_request_context
from backend.python.gl_coding import GlAccount
from backend.python.main import app, get_gl_account_mapping_repository

TENANT_ID = UUID("40000000-0000-4000-8000-000000000300")
PACT_FILE = Path("pacts/core-case-service-gl-coding-service.json")
PACT_VERIFIER = Path("node_modules/.bin/pact-verifier")
PACT_VERIFIER_TIMEOUT_SECONDS = 15


class PactGlAccountMappingRepository:
    """Return state-controlled synthetic GL mappings for Pact verification."""

    def __init__(self) -> None:
        self.accounts_by_category: dict[str, GlAccount] = {}

    async def get_accounts_for_categories(
        self, tenant_id: UUID, categories: set[str]
    ) -> dict[str, GlAccount]:
        """Return only requested synthetic accounts for the active provider state."""
        assert tenant_id == TENANT_ID
        return {
            category: account
            for category, account in self.accounts_by_category.items()
            if category in categories
        }


def free_port() -> int:
    """Return an available localhost port for a temporary verifier server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def run_uvicorn_server(server_app: FastAPI, port: int) -> Iterator[None]:
    """Run an ASGI app until the test exits."""
    config = uvicorn.Config(
        server_app,
        host="127.0.0.1",
        port=port,
        # Startup/JWT config validation is covered separately in test_auth_jwt.py.
        lifespan="off",
        log_level="critical",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    try:
        thread.start()
        wait_for_server(port)
        yield
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def wait_for_server(port: int) -> None:
    """Wait until a temporary localhost server is accepting requests."""
    deadline = time.monotonic() + 5
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/health", timeout=0.2):
                return
        except (ConnectionError, TimeoutError, URLError) as error:
            last_error = error
            time.sleep(0.05)

    raise RuntimeError(f"Timed out waiting for test server on port {port}") from last_error


def provider_state_app(repository: PactGlAccountMappingRepository) -> FastAPI:
    """Create a state-change endpoint for the Pact verifier."""
    state_app = FastAPI()

    @state_app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ready"}

    @state_app.post("/pact/provider-state")
    async def provider_state(payload: dict[str, Any]) -> dict[str, str]:
        state = str(payload.get("state", ""))
        repository.accounts_by_category = accounts_for_state(state)
        return {"result": "ok"}

    return state_app


def accounts_for_state(state: str) -> dict[str, GlAccount]:
    """Return synthetic GL mappings required for a Pact provider state."""
    if state == "the Travel GL mapping is available":
        return {
            "Travel": GlAccount(
                account_code="6000",
                account_name="Travel Expense",
            )
        }
    if state == "the Meals GL mapping is available":
        return {
            "Meals": GlAccount(
                account_code="6100",
                account_name="Meals Expense",
            )
        }
    if state == "the Mileage GL mapping is available":
        return {
            "Mileage": GlAccount(
                account_code="6300",
                account_name="Mileage Expense",
            )
        }

    return {}


async def finance_admin_context() -> AuthenticatedRequestContext:
    """Return a synthetic internal user context for provider verification."""
    return AuthenticatedRequestContext(
        tenant_id=TENANT_ID,
        role="Finance Admin",
        roles=["Finance Admin"],
    )


def verify_pact(provider_port: int, state_port: int) -> subprocess.CompletedProcess[str]:
    """Run the Pact verifier against a temporary GL-coding provider server."""
    require_pact_verifier()
    command = [
        str(PACT_VERIFIER),
        "--file",
        str(PACT_FILE),
        "--provider-name",
        "gl-coding-service",
        "--hostname",
        "127.0.0.1",
        "--port",
        str(provider_port),
        "--state-change-url",
        f"http://127.0.0.1:{state_port}/pact/provider-state",
        "--loglevel",
        "error",
        "--no-colour",
    ]
    try:
        return subprocess.run(
            command,
            check=False,
            text=True,
            capture_output=True,
            timeout=PACT_VERIFIER_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        pytest.fail(
            "Pact verifier timed out after "
            f"{PACT_VERIFIER_TIMEOUT_SECONDS} seconds.\n"
            f"{timeout_output(error.stdout)}{timeout_output(error.stderr)}"
        )


def timeout_output(output: str | bytes | None) -> str:
    """Return captured timeout output as text for pytest failure messages."""
    if output is None:
        return ""
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace")
    return output


def require_pact_verifier() -> None:
    """Fail clearly when the local Pact verifier CLI has not been installed."""
    if not PACT_VERIFIER.exists():
        pytest.fail(
            "Pact verifier binary was not found at "
            f"{PACT_VERIFIER}. Was npm install run before the provider suite?"
        )


def test_gl_coding_provider_verifies_core_case_service_pact() -> None:
    repository = PactGlAccountMappingRepository()
    provider_port = free_port()
    state_port = free_port()

    app.state.mileage_reimbursement_rate = Decimal("0.70")
    app.dependency_overrides[require_request_context] = finance_admin_context
    app.dependency_overrides[get_gl_account_mapping_repository] = lambda: repository
    try:
        with (
            run_uvicorn_server(app, provider_port),
            run_uvicorn_server(provider_state_app(repository), state_port),
        ):
            result = verify_pact(provider_port, state_port)
    finally:
        app.dependency_overrides.pop(require_request_context, None)
        app.dependency_overrides.pop(get_gl_account_mapping_repository, None)

    assert result.returncode == 0, result.stdout + result.stderr


def test_gl_coding_provider_pact_fails_when_response_breaks_contract() -> None:
    repository = PactGlAccountMappingRepository()
    provider_port = free_port()
    state_port = free_port()

    with (
        run_uvicorn_server(broken_provider_app(repository), provider_port),
        run_uvicorn_server(provider_state_app(repository), state_port),
    ):
        result = verify_pact(provider_port, state_port)

    verifier_output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "flagged_line_item" in verifier_output


def broken_provider_app(repository: PactGlAccountMappingRepository) -> FastAPI:
    """Create a provider that intentionally omits a required Pact response field."""
    broken_app = FastAPI()

    @broken_app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ready"}

    @broken_app.post("/gl-coding/line-items")
    async def gl_coding_line_items(payload: dict[str, Any]) -> dict[str, Any]:
        coded_items = [
            broken_line_item_response(line_item, repository)
            for line_item in payload.get("line_items", [])
        ]
        coded_items.extend(
            broken_mileage_response(mileage_entry, repository)
            for mileage_entry in payload.get("mileage", [])
        )
        return {"coded_items": coded_items, "flags": flags_for_payload(payload)}

    return broken_app


def broken_line_item_response(
    line_item: dict[str, Any], repository: PactGlAccountMappingRepository
) -> dict[str, Any]:
    """Return a line-item response missing flagged_line_item for regression coverage."""
    category = str(line_item["category"])
    gl_account = repository.accounts_by_category.get(category)
    return {
        "source_id": line_item["line_item_id"],
        "source_type": "line_item",
        "category": category,
        "mapping_status": "mapped" if gl_account is not None else "unmapped",
        "gl_account": gl_account.model_dump() if gl_account is not None else None,
        "amount": line_item["amount"],
        "currency": line_item["currency"],
    }


def broken_mileage_response(
    mileage_entry: dict[str, Any], repository: PactGlAccountMappingRepository
) -> dict[str, Any]:
    """Return a mileage response missing flagged_line_item for regression coverage."""
    gl_account = repository.accounts_by_category.get("Mileage")
    return {
        "source_id": mileage_entry["mileage_entry_id"],
        "source_type": "mileage",
        "category": "Mileage",
        "mapping_status": "mapped" if gl_account is not None else "unmapped",
        "gl_account": gl_account.model_dump() if gl_account is not None else None,
    }


def flags_for_payload(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Return the threshold flag expected by the checked-in Pact file."""
    flags: list[dict[str, str]] = []
    for line_item in payload.get("line_items", []):
        if str(line_item["amount"]) > "500.00":
            flags.append(
                {
                    "source_id": str(line_item["line_item_id"]),
                    "source_type": "line_item",
                    "code": "line_item_over_threshold",
                    "message": "Line item amount is above the MVP manual review threshold.",
                }
            )
    return flags
