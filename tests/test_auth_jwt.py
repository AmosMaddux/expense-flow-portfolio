import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import re
import subprocess
import tempfile
import time
from pathlib import Path
from threading import Thread
from typing import Any, cast

import anyio
import pytest
from fastapi import Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from backend.python.auth import (
    AuthJwtConfigurationError,
    AuthJwtVerifier,
    require_authenticated_identity,
    require_request_context,
)
from backend.python.main import app, lifespan

ROOT_DIR = Path(__file__).resolve().parents[1]
AUTH_JWT_ISSUER = "expenseflow-core-case-service"
TENANT_ID = "11111111-1111-4111-8111-111111111111"
USER_ID = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(scope="session")
def node_build() -> None:
    subprocess.run(["npm", "run", "build"], cwd=ROOT_DIR, check=True)


@pytest.fixture()
def generated_jwt_environment(tmp_path: Path) -> dict[str, str]:
    env_file = tmp_path / "jwt.env"
    subprocess.run(
        ["./scripts/generate-dev-jwt-keys.sh", str(env_file)],
        cwd=ROOT_DIR,
        check=True,
    )

    return parse_env_file(env_file)


@pytest.fixture()
def generated_next_jwt_environment(tmp_path: Path) -> dict[str, str]:
    env_file = tmp_path / "next-jwt.env"
    subprocess.run(
        ["./scripts/generate-dev-jwt-keys.sh", str(env_file)],
        cwd=ROOT_DIR,
        check=True,
    )

    return parse_env_file(env_file)


@pytest.mark.anyio
async def test_auth_me_accepts_login_service_minted_access_token_over_http(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment(
        generated_jwt_environment
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/auth/me", headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": USER_ID,
        "tenant_id": TENANT_ID,
        "roles": ["Employee"],
        "iss": AUTH_JWT_ISSUER,
        "iat": response.json()["iat"],
        "exp": response.json()["exp"],
        "token_use": "access",
    }
    assert isinstance(response.json()["exp"], int)
    assert isinstance(response.json()["iat"], int)


@pytest.mark.anyio
async def test_auth_context_exposes_tenant_and_primary_role_over_http(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment(
        generated_jwt_environment
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/auth/context", headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "tenant_id": TENANT_ID,
        "role": "Employee",
        "roles": ["Employee"],
    }


@pytest.mark.anyio
async def test_auth_context_preserves_multi_role_assignments_over_http(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_raw_access_token(
        generated_jwt_environment,
        {"roles": ["Employee", "Finance Admin"]},
    )
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment(
        generated_jwt_environment
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/auth/context", headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "tenant_id": TENANT_ID,
        "role": "Finance Admin",
        "roles": ["Employee", "Finance Admin"],
    }


@pytest.mark.anyio
async def test_auth_context_rejects_missing_token_before_handler_context(
    generated_jwt_environment: dict[str, str],
) -> None:
    handler_was_called = False
    test_app = FastAPI()
    test_app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment(
        generated_jwt_environment
    )

    # Test-only route: if auth dependency short-circuiting fails, this body runs.
    @test_app.get("/protected", dependencies=[Depends(require_request_context)])
    async def protected_route() -> dict[str, bool]:
        nonlocal handler_was_called
        handler_was_called = True
        return {"handler_was_called": handler_was_called}

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or missing bearer token."}
    assert handler_was_called is False


def test_auth_verifier_loads_public_keys_from_jwks_url(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)

    with serve_jwks(generated_jwt_environment["AUTH_JWT_JWKS_JSON"]) as server:
        identity = require_identity(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
            },
            f"Bearer {token}",
        )

    assert str(identity.user_id) == USER_ID
    assert str(identity.tenant_id) == TENANT_ID


def test_auth_verifier_refreshes_jwks_url_on_unknown_kid(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    old_token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    next_token = mint_node_access_token(
        generated_next_jwt_environment, key_id="next-key", ttl_seconds=300
    )

    with serve_jwks(generated_jwt_environment["AUTH_JWT_JWKS_JSON"]) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
            }
        )
        old_identity = anyio.run(
            require_authenticated_identity,
            make_request(f"Bearer {old_token}"),
            verifier,
        )
        server.set_jwks_json(
            json.dumps(
                {
                    "keys": [
                        jwk_with_key_id(
                            generated_jwt_environment, "local-dev-rs256-v1"
                        ),
                        jwk_with_key_id(generated_next_jwt_environment, "next-key"),
                    ]
                },
                separators=(",", ":"),
            )
        )
        next_identity = anyio.run(
            require_authenticated_identity,
            make_request(f"Bearer {next_token}"),
            verifier,
        )

    assert str(old_identity.user_id) == USER_ID
    assert str(next_identity.user_id) == USER_ID


def test_auth_verifier_throttles_unknown_kid_jwks_refreshes(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    unknown_token = mint_node_access_token(
        generated_jwt_environment, key_id="unknown-key", ttl_seconds=300
    )

    with serve_jwks(generated_jwt_environment["AUTH_JWT_JWKS_JSON"]) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
                "AUTH_JWT_JWKS_CACHE_TTL_SECONDS": "300",
                "AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS": "30",
            }
        )
        startup_request_count = server.request_count

        for _ in range(2):
            with pytest.raises(HTTPException) as error:
                anyio.run(
                    require_authenticated_identity,
                    make_request(f"Bearer {unknown_token}"),
                    verifier,
                )
            assert error.value.status_code == 401

    assert server.request_count == startup_request_count + 1


def test_auth_verifier_configuration_normalizes_malformed_jwk_values() -> None:
    malformed_jwks_json = json.dumps(
        {
            "keys": [
                {
                    "kty": "RSA",
                    "kid": "malformed-key",
                    "use": "sig",
                    "alg": "RS256",
                    "n": "not-valid-base64url!",
                    "e": "AQAB",
                }
            ]
        }
    )

    with pytest.raises(AuthJwtConfigurationError):
        AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_JSON": malformed_jwks_json,
            }
        )


def test_auth_verifier_refreshes_bootstrap_jwks_json_from_jwks_url(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    next_token = mint_node_access_token(
        generated_next_jwt_environment, key_id="next-key", ttl_seconds=300
    )
    next_jwks_json = json.dumps(
        {"keys": [jwk_with_key_id(generated_next_jwt_environment, "next-key")]},
        separators=(",", ":"),
    )

    with serve_jwks(next_jwks_json) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_JSON": generated_jwt_environment["AUTH_JWT_JWKS_JSON"],
                "AUTH_JWT_JWKS_URL": server.url,
                "AUTH_JWT_JWKS_CACHE_TTL_SECONDS": "300",
            }
        )
        identity = anyio.run(
            require_authenticated_identity,
            make_request(f"Bearer {next_token}"),
            verifier,
        )

    assert str(identity.user_id) == USER_ID


def test_auth_verifier_rejects_removed_key_after_jwks_cache_ttl(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    old_token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    initial_jwks_json = json.dumps(
        {
            "keys": [
                jwk_with_key_id(generated_jwt_environment, "local-dev-rs256-v1"),
                jwk_with_key_id(generated_next_jwt_environment, "next-key"),
            ]
        },
        separators=(",", ":"),
    )
    next_only_jwks_json = json.dumps(
        {"keys": [jwk_with_key_id(generated_next_jwt_environment, "next-key")]},
        separators=(",", ":"),
    )

    with serve_jwks(initial_jwks_json) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
                "AUTH_JWT_JWKS_CACHE_TTL_SECONDS": "0",
            }
        )
        old_identity = anyio.run(
            require_authenticated_identity,
            make_request(f"Bearer {old_token}"),
            verifier,
        )
        server.set_jwks_json(next_only_jwks_json)

        with pytest.raises(HTTPException) as error:
            anyio.run(
                require_authenticated_identity,
                make_request(f"Bearer {old_token}"),
                verifier,
            )

    assert str(old_identity.user_id) == USER_ID
    assert error.value.status_code == 401


def test_auth_verifier_coalesces_concurrent_stale_jwks_refreshes(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)

    with serve_jwks(generated_jwt_environment["AUTH_JWT_JWKS_JSON"]) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
                "AUTH_JWT_JWKS_CACHE_TTL_SECONDS": "300",
            }
        )
        verifier._next_jwks_refresh_at = 0.0
        startup_request_count = server.request_count

        with ThreadPoolExecutor(max_workers=4) as executor:
            identities = list(
                executor.map(
                    lambda _: anyio.run(
                        require_authenticated_identity,
                        make_request(f"Bearer {token}"),
                        verifier,
                    ),
                    range(4),
                )
            )

    assert [str(identity.user_id) for identity in identities] == [USER_ID] * 4
    assert server.request_count == startup_request_count + 1


def test_auth_verifier_retries_jwks_url_at_startup(
    generated_jwt_environment: dict[str, str],
) -> None:
    with serve_jwks(
        generated_jwt_environment["AUTH_JWT_JWKS_JSON"], failures=1
    ) as server:
        verifier = AuthJwtVerifier.from_environment(
            {
                "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
                "AUTH_JWT_JWKS_URL": server.url,
                "AUTH_JWT_JWKS_STARTUP_RETRIES": "2",
                "AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS": "0",
            }
        )

    assert isinstance(verifier, AuthJwtVerifier)
    assert server.request_count == 2


def test_auth_verifier_accepts_single_key_fallback(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    identity = require_identity(generated_jwt_environment, f"Bearer {token}")

    assert str(identity.user_id) == USER_ID
    assert str(identity.tenant_id) == TENANT_ID


def test_auth_verifier_accepts_matching_kid_from_rotation_key_map(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    key_map_environment = create_key_map_environment(
        generated_jwt_environment, generated_next_jwt_environment
    )
    token = mint_node_access_token(
        generated_jwt_environment, key_id="old-key", ttl_seconds=300
    )
    identity = require_identity(key_map_environment, f"Bearer {token}")

    assert str(identity.user_id) == USER_ID
    assert str(identity.tenant_id) == TENANT_ID


def test_auth_verifier_rejects_unknown_kid_from_rotation_key_map(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    key_map_environment = create_key_map_environment(
        generated_jwt_environment, generated_next_jwt_environment
    )
    token = mint_node_access_token(
        generated_jwt_environment, key_id="unknown-key", ttl_seconds=300
    )

    with pytest.raises(HTTPException) as error:
        require_identity(key_map_environment, f"Bearer {token}")

    assert error.value.status_code == 401


def test_auth_verifier_rejects_missing_kid_when_rotating_keys(
    generated_jwt_environment: dict[str, str],
    generated_next_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    key_map_environment = create_key_map_environment(
        generated_jwt_environment, generated_next_jwt_environment
    )
    token = mint_node_access_token(
        generated_jwt_environment, key_id="__none__", ttl_seconds=300
    )

    with pytest.raises(HTTPException) as error:
        require_identity(key_map_environment, f"Bearer {token}")

    assert error.value.status_code == 401


def test_auth_verifier_accepts_token_expired_within_clock_skew(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    environment = {
        **generated_jwt_environment,
        "AUTH_JWT_CLOCK_SKEW_SECONDS": "10",
    }
    token = mint_node_access_token(
        environment, issued_at_offset_seconds=-5, ttl_seconds=1
    )
    identity = require_identity(environment, f"Bearer {token}")

    assert str(identity.user_id) == USER_ID


def test_auth_verifier_rejects_token_expired_beyond_clock_skew(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    environment = {
        **generated_jwt_environment,
        "AUTH_JWT_CLOCK_SKEW_SECONDS": "10",
    }
    token = mint_node_access_token(
        environment, issued_at_offset_seconds=-20, ttl_seconds=1
    )

    with pytest.raises(HTTPException) as error:
        require_identity(environment, f"Bearer {token}")

    assert error.value.status_code == 401


def test_auth_me_rejects_expired_node_minted_access_token(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(
        generated_jwt_environment, issued_at_offset_seconds=-120, ttl_seconds=1
    )

    with pytest.raises(HTTPException) as error:
        require_identity(generated_jwt_environment, f"Bearer {token}")

    assert error.value.status_code == 401


def test_auth_verifier_rejects_node_minted_refresh_token(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_refresh_token(generated_jwt_environment, ttl_seconds=300)

    with pytest.raises(HTTPException) as error:
        require_identity(generated_jwt_environment, f"Bearer {token}")

    assert error.value.status_code == 401


@pytest.mark.parametrize(
    "claim_overrides",
    [
        {"sub": "not-a-uuid"},
        {"tenant_id": "not-a-uuid"},
        {"roles": []},
        {"roles": ["Superuser"]},
    ],
    ids=[
        "non_uuid_sub",
        "non_uuid_tenant_id",
        "empty_roles",
        "unknown_role",
    ],
)
def test_auth_verifier_rejects_validly_signed_token_with_malformed_claims(
    generated_jwt_environment: dict[str, str],
    node_build: None,
    claim_overrides: dict[str, Any],
) -> None:
    token = mint_raw_access_token(generated_jwt_environment, claim_overrides)

    with pytest.raises(HTTPException) as error:
        require_identity(generated_jwt_environment, f"Bearer {token}")

    assert error.value.status_code == 401


def test_auth_me_rejects_tampered_access_token(
    generated_jwt_environment: dict[str, str],
    node_build: None,
) -> None:
    token = mint_node_access_token(generated_jwt_environment, ttl_seconds=300)
    tampered_token = tamper_token_payload(token)

    with pytest.raises(HTTPException) as error:
        require_identity(generated_jwt_environment, f"Bearer {tampered_token}")

    assert error.value.status_code == 401


@pytest.mark.parametrize("authorization", [None, "Basic synthetic"])
def test_auth_me_rejects_missing_or_non_bearer_authorization(
    generated_jwt_environment: dict[str, str],
    authorization: str | None,
) -> None:
    with pytest.raises(HTTPException) as error:
        require_identity(generated_jwt_environment, authorization)

    assert error.value.status_code == 401


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"AUTH_JWT_JWKS_JSON": "not-json"},
        {"AUTH_JWT_JWKS_JSON": "{}"},
        {"AUTH_JWT_JWKS_JSON": json.dumps({"keys": []})},
        {
            "AUTH_JWT_JWKS_JSON": json.dumps({"keys": []}),
            "AUTH_JWT_CLOCK_SKEW_SECONDS": "-1",
        },
    ],
)
def test_auth_verifier_configuration_errors_are_not_401(
    environment: dict[str, str],
) -> None:
    with pytest.raises(AuthJwtConfigurationError):
        AuthJwtVerifier.from_environment(environment)


def test_auth_verifier_configuration_is_validated_at_startup(monkeypatch) -> None:
    monkeypatch.delenv("AUTH_JWT_JWKS_JSON", raising=False)
    monkeypatch.delenv("AUTH_JWT_JWKS_URL", raising=False)

    async def start_app_without_auth_config() -> None:
        async with lifespan(app):
            pass

    with pytest.raises(AuthJwtConfigurationError):
        anyio.run(start_app_without_auth_config)


def test_tracked_test_sources_do_not_commit_jwt_secrets_or_tokens() -> None:
    tracked_files = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    suspicious_patterns = [
        re.compile(r"-----BEGIN (?:RSA )?(?:PRIVATE|PUBLIC) KEY-----"),
        re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
        re.compile(r"AUTH_JWT_PRIVATE_KEY_BASE64=[A-Za-z0-9+/]{80,}={0,2}"),
    ]

    for relative_path in tracked_files:
        if should_skip_secret_scan(relative_path):
            continue

        # Latin-1 preserves ASCII secret patterns while representing arbitrary binary bytes.
        content = (ROOT_DIR / relative_path).read_bytes().decode("latin-1")
        for pattern in suspicious_patterns:
            assert pattern.search(content) is None, relative_path


def test_secret_scan_png_skip_is_limited_to_design_wireframes() -> None:
    assert should_skip_secret_scan("docs/design/wireframes/sign_in/screen.png") is True
    assert (
        should_skip_secret_scan("frontend/app/src/assets/exported-secret.png") is False
    )


def test_jwt_key_generator_rejects_repo_tracked_output_paths(tmp_path: Path) -> None:
    blocked_env_file = ROOT_DIR / "tests" / "support" / "blocked-jwt.env"

    result = subprocess.run(
        ["./scripts/generate-dev-jwt-keys.sh", str(blocked_env_file)],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert "Refusing to write generated JWT keys" in result.stderr
    assert not blocked_env_file.exists()

    allowed_temp_env_file = tmp_path / "jwt.env"
    subprocess.run(
        ["./scripts/generate-dev-jwt-keys.sh", str(allowed_temp_env_file)],
        cwd=ROOT_DIR,
        check=True,
    )
    assert allowed_temp_env_file.exists()


def parse_env_file(env_file: Path) -> dict[str, str]:
    environment: dict[str, str] = {"AUTH_JWT_ISSUER": AUTH_JWT_ISSUER}

    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.strip() == "" or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        environment[key] = value

    return environment


def create_key_map_environment(
    old_environment: dict[str, str],
    next_environment: dict[str, str],
) -> dict[str, str]:
    return {
        "AUTH_JWT_ISSUER": AUTH_JWT_ISSUER,
        "AUTH_JWT_JWKS_JSON": json.dumps(
            {
                "keys": [
                    jwk_with_key_id(old_environment, "old-key"),
                    jwk_with_key_id(next_environment, "next-key"),
                ]
            },
            separators=(",", ":"),
        ),
    }


class JwksTestServer:
    def __init__(
        self,
        server: HTTPServer,
        thread: Thread,
        jwks_json: str,
        failures: int,
    ) -> None:
        self._server = server
        self._thread = thread
        self._jwks_json = jwks_json
        self._failures_remaining = failures
        self.request_count = 0
        host, port = cast(tuple[str, int], server.server_address[:2])
        self.url = f"http://{host}:{port}/.well-known/jwks.json"

    def set_jwks_json(self, jwks_json: str) -> None:
        self._jwks_json = jwks_json

    def response_body(self) -> bytes | None:
        self.request_count += 1
        if self._failures_remaining > 0:
            self._failures_remaining -= 1
            return None

        return self._jwks_json.encode("utf-8")

    def close(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=5)
        self._server.server_close()


@contextmanager
def serve_jwks(jwks_json: str, failures: int = 0):
    holder: dict[str, JwksTestServer] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/.well-known/jwks.json":
                self.send_response(404)
                self.end_headers()
                return

            body = holder["server"].response_body()
            if body is None:
                self.send_response(503)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    http_server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=http_server.serve_forever, daemon=True)
    server = JwksTestServer(http_server, thread, jwks_json, failures)
    holder["server"] = server
    thread.start()
    try:
        yield server
    finally:
        server.close()


def jwk_with_key_id(environment: dict[str, str], key_id: str) -> dict[str, str]:
    jwks = json.loads(environment["AUTH_JWT_JWKS_JSON"])
    public_jwk = jwks["keys"][0]
    return {**public_jwk, "kid": key_id}


def require_identity(
    environment: dict[str, str],
    authorization: str | None,
):
    request = make_request(authorization)
    verifier = AuthJwtVerifier.from_environment(environment)
    return anyio.run(require_authenticated_identity, request, verifier)


def make_request(authorization: str | None) -> Request:
    headers = []
    if authorization is not None:
        headers.append((b"authorization", authorization.encode("utf-8")))

    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/auth/me",
            "headers": headers,
            "query_string": b"",
            "server": ("testserver", 80),
            "scheme": "http",
            "client": ("testclient", 50000),
        }
    )


def mint_node_access_token(
    environment: dict[str, str],
    *,
    issued_at_offset_seconds: int = -30,
    key_id: str | None = None,
    ttl_seconds: int,
) -> str:
    script = ROOT_DIR / "tests" / "support" / "mint-node-access-token.mjs"
    resolved_key_id = (
        key_id if key_id is not None else environment.get("AUTH_JWT_KEY_ID", "default")
    )
    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8") as token_file:
        subprocess.run(
            [
                "node",
                str(script),
                environment["AUTH_JWT_PRIVATE_KEY_BASE64"],
                resolved_key_id,
                AUTH_JWT_ISSUER,
                str(issued_at_offset_seconds),
                str(ttl_seconds),
            ],
            cwd=ROOT_DIR,
            check=True,
            stdout=token_file,
            timeout=10,
        )
        token_file.seek(0)
        return token_file.read().strip()


def mint_raw_access_token(
    environment: dict[str, str],
    claim_overrides: dict[str, Any],
    *,
    key_id: str | None = None,
    issued_at_offset_seconds: int = -30,
    ttl_seconds: int = 300,
) -> str:
    issued_at = int(time.time()) + issued_at_offset_seconds
    payload = {
        "iss": AUTH_JWT_ISSUER,
        "sub": USER_ID,
        "tenant_id": TENANT_ID,
        "roles": ["Employee"],
        "token_use": "access",
        "iat": issued_at,
        "exp": issued_at + ttl_seconds,
        **claim_overrides,
    }
    resolved_key_id = (
        key_id if key_id is not None else environment.get("AUTH_JWT_KEY_ID", "default")
    )
    script = ROOT_DIR / "tests" / "support" / "mint-raw-access-token.mjs"
    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8") as token_file:
        subprocess.run(
            [
                "node",
                str(script),
                environment["AUTH_JWT_PRIVATE_KEY_BASE64"],
                resolved_key_id,
                json.dumps(payload),
            ],
            cwd=ROOT_DIR,
            check=True,
            stdout=token_file,
            timeout=10,
        )
        token_file.seek(0)
        return token_file.read().strip()


def mint_node_refresh_token(
    environment: dict[str, str],
    *,
    issued_at_offset_seconds: int = -30,
    key_id: str | None = None,
    ttl_seconds: int,
) -> str:
    script = ROOT_DIR / "tests" / "support" / "mint-node-refresh-token.mjs"
    resolved_key_id = (
        key_id if key_id is not None else environment.get("AUTH_JWT_KEY_ID", "default")
    )
    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8") as token_file:
        subprocess.run(
            [
                "node",
                str(script),
                environment["AUTH_JWT_PRIVATE_KEY_BASE64"],
                resolved_key_id,
                AUTH_JWT_ISSUER,
                str(issued_at_offset_seconds),
                str(ttl_seconds),
            ],
            cwd=ROOT_DIR,
            check=True,
            stdout=token_file,
            timeout=10,
        )
        token_file.seek(0)
        return token_file.read().strip()


def tamper_token_payload(token: str) -> str:
    header, payload, signature = token.split(".")
    decoded_payload = decode_base64url_json(payload)
    decoded_payload["tenant_id"] = "33333333-3333-4333-8333-333333333333"
    encoded_payload = encode_base64url_json(decoded_payload)
    return f"{header}.{encoded_payload}.{signature}"


def decode_base64url_json(value: str) -> dict[str, Any]:
    padded_value = value + "=" * (-len(value) % 4)
    return json.loads(__import__("base64").urlsafe_b64decode(padded_value))


def encode_base64url_json(value: dict[str, Any]) -> str:
    encoded = __import__("base64").urlsafe_b64encode(
        json.dumps(value, separators=(",", ":")).encode("utf-8")
    )
    return encoded.decode("utf-8").rstrip("=")


def should_skip_secret_scan(relative_path: str) -> bool:
    path = Path(relative_path)
    if path.suffix == ".png" and relative_path.startswith("docs/design/wireframes/"):
        return True

    return relative_path in {
        "package-lock.json",
        "uv.lock",
    } or relative_path.startswith("backend/core-case-service/drizzle/meta/")
