import binascii
import json
import os
import time
from threading import Lock
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Mapping
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import InvalidTokenError, PyJWK, PyJWKError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

AUTH_JWT_ISSUER_DEFAULT = "expenseflow-core-case-service"
AUTH_JWT_AUDIENCE_DEFAULT = "expenseflow-http-api"
AUTH_JWT_CLOCK_SKEW_SECONDS_DEFAULT = 10
AUTH_JWT_JWKS_TIMEOUT_SECONDS_DEFAULT = 5
AUTH_JWT_JWKS_CACHE_TTL_SECONDS_DEFAULT = 300
AUTH_JWT_JWKS_STARTUP_RETRIES_DEFAULT = 3
AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS_DEFAULT = 0.25
AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS_DEFAULT = 5

# Mirrors backend/core-case-service/src/db/schema/identityAuth.ts roleValues.
RoleName = Literal[
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]
ServicePermission = Literal["expense-report:submit"]
ROLE_PRECEDENCE: tuple[RoleName, ...] = (
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
)


class AuthJwtConfigurationError(RuntimeError):
    """Report invalid shared JWT verifier configuration."""


class AuthenticatedIdentity(BaseModel):
    """Represent a validated tenant-scoped JWT identity."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: UUID = Field(alias="sub")
    tenant_id: UUID
    roles: list[RoleName] = Field(min_length=1)
    service_permissions: list[ServicePermission] = Field(
        default_factory=list, exclude=True
    )
    iss: str
    aud: str = Field(exclude=True)
    iat: int
    exp: int
    token_use: Literal["access"]


class AuthenticatedRequestContext(BaseModel):
    """Represent the trusted tenant and role context for request handlers."""

    tenant_id: UUID
    role: RoleName
    roles: list[RoleName] = Field(min_length=1)
    service_permissions: list[ServicePermission] = Field(
        default_factory=list, exclude=True
    )


class RsaPublicJwk(BaseModel):
    """Validate one RSA signing key from the issuer JWKS."""

    kty: Literal["RSA"]
    kid: str = Field(min_length=1)
    use: Literal["sig"]
    alg: Literal["RS256"]
    n: str = Field(min_length=1)
    e: str = Field(min_length=1)


class JsonWebKeySet(BaseModel):
    """Validate the issuer public JSON Web Key Set."""

    keys: list[RsaPublicJwk] = Field(min_length=1)


@dataclass(frozen=True)
class AuthJwtVerifierConfig:
    """Hold validated shared JWT verifier settings."""

    issuer: str
    audience: str
    public_keys_by_id: dict[str, Any]
    clock_skew_seconds: int
    jwks_url: str | None = None
    jwks_timeout_seconds: int = AUTH_JWT_JWKS_TIMEOUT_SECONDS_DEFAULT
    jwks_cache_ttl_seconds: float = AUTH_JWT_JWKS_CACHE_TTL_SECONDS_DEFAULT
    jwks_miss_refresh_cooldown_seconds: float = (
        AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS_DEFAULT
    )


class AuthJwtVerifier:
    """Verify shared RS256 JWTs issued by the Node service."""

    def __init__(self, config: AuthJwtVerifierConfig) -> None:
        self._config = config
        self._public_keys_by_id = dict(config.public_keys_by_id)
        self._refresh_lock = Lock()
        self._next_jwks_refresh_at = time.monotonic() + config.jwks_cache_ttl_seconds
        self._next_jwks_miss_refresh_at = 0.0

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str] | None = None
    ) -> "AuthJwtVerifier":
        """Create a verifier from validated process environment settings."""
        return cls(load_auth_jwt_verifier_config(environment))

    async def verify_async(self, token: str) -> AuthenticatedIdentity:
        """Return validated identity for protected async request handlers."""
        return self.verify(token)

    def verify(self, token: str) -> AuthenticatedIdentity:
        """Return identity claims after signature, issuer, and expiry validation."""
        try:
            key = self._select_public_key(token)
            payload = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=self._config.issuer,
                audience=self._config.audience,
                leeway=self._config.clock_skew_seconds,
                options={
                    "require": [
                        "exp",
                        "iat",
                        "iss",
                        "aud",
                        "sub",
                        "tenant_id",
                        "roles",
                        "token_use",
                    ]
                },
            )
            return AuthenticatedIdentity.model_validate(payload)
        except (InvalidTokenError, ValidationError) as error:
            raise unauthorized() from error

    def _select_public_key(self, token: str) -> Any:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise unauthorized()

        key_id = header.get("kid")
        if not isinstance(key_id, str) or key_id.strip() == "":
            raise unauthorized()

        self._refresh_public_keys_if_stale()
        public_key = self._public_keys_by_id.get(key_id)
        if public_key is not None:
            return public_key

        return self._refresh_public_keys_for_cache_miss(key_id)

    def _refresh_public_keys_if_stale(self) -> None:
        if self._config.jwks_url is None:
            return
        if time.monotonic() < self._next_jwks_refresh_at:
            return

        self._refresh_public_keys()

    def _refresh_public_keys_for_cache_miss(self, key_id: str) -> Any:
        if self._config.jwks_url is None:
            raise unauthorized()

        with self._refresh_lock:
            public_key = self._public_keys_by_id.get(key_id)
            if public_key is not None:
                return public_key

            current_time = time.monotonic()
            if current_time < self._next_jwks_miss_refresh_at:
                raise unauthorized()

            self._next_jwks_miss_refresh_at = (
                current_time + self._config.jwks_miss_refresh_cooldown_seconds
            )
            self._refresh_public_keys_unlocked()
            public_key = self._public_keys_by_id.get(key_id)
            if public_key is None:
                raise unauthorized()

            return public_key

    def _refresh_public_keys(self) -> None:
        if self._config.jwks_url is None:
            raise unauthorized()

        with self._refresh_lock:
            if time.monotonic() < self._next_jwks_refresh_at:
                return

            self._refresh_public_keys_unlocked()

    def _refresh_public_keys_unlocked(self) -> None:
        if self._config.jwks_url is None:
            raise unauthorized()

        try:
            jwks = fetch_and_validate_jwks(
                self._config.jwks_url,
                self._config.jwks_timeout_seconds,
            )
            self._public_keys_by_id = build_public_keys_by_id(jwks)
            self._next_jwks_refresh_at = (
                time.monotonic() + self._config.jwks_cache_ttl_seconds
            )
        except AuthJwtConfigurationError as error:
            self._next_jwks_refresh_at = (
                time.monotonic() + self._config.jwks_cache_ttl_seconds
            )
            raise unauthorized() from error


def load_auth_jwt_verifier_config(
    environment: Mapping[str, str] | None = None,
) -> AuthJwtVerifierConfig:
    """Read and validate shared JWT verifier settings."""
    env = environment if environment is not None else os.environ
    issuer = read_issuer(env)
    audience = read_audience(env)
    clock_skew_seconds = read_clock_skew_seconds(env)
    jwks_timeout_seconds = read_jwks_timeout_seconds(env)
    jwks_cache_ttl_seconds = read_jwks_cache_ttl_seconds(env)
    jwks_miss_refresh_cooldown_seconds = read_jwks_miss_refresh_cooldown_seconds(env)
    startup_retries = read_jwks_startup_retries(env)
    startup_backoff_seconds = read_jwks_startup_backoff_seconds(env)
    raw_jwks = env.get("AUTH_JWT_JWKS_JSON")
    jwks_url = read_optional_jwks_url(env)

    if raw_jwks is not None and raw_jwks.strip() != "":
        jwks = decode_jwks(raw_jwks)
    elif jwks_url is not None:
        jwks = fetch_and_validate_jwks_with_retries(
            jwks_url,
            jwks_timeout_seconds,
            startup_retries,
            startup_backoff_seconds,
        )
    else:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_JSON or AUTH_JWT_JWKS_URL is required."
        )
    public_keys_by_id = build_public_keys_by_id(jwks)

    return AuthJwtVerifierConfig(
        issuer=issuer,
        audience=audience,
        public_keys_by_id=public_keys_by_id,
        clock_skew_seconds=clock_skew_seconds,
        jwks_url=jwks_url,
        jwks_timeout_seconds=jwks_timeout_seconds,
        jwks_cache_ttl_seconds=jwks_cache_ttl_seconds,
        jwks_miss_refresh_cooldown_seconds=jwks_miss_refresh_cooldown_seconds,
    )


def read_issuer(env: Mapping[str, str]) -> str:
    """Read the expected shared JWT issuer."""
    issuer = env.get("AUTH_JWT_ISSUER", AUTH_JWT_ISSUER_DEFAULT)
    if issuer.strip() == "":
        raise AuthJwtConfigurationError("AUTH_JWT_ISSUER cannot be blank.")
    return issuer


def read_audience(env: Mapping[str, str]) -> str:
    """Read the expected shared JWT audience."""
    audience = env.get("AUTH_JWT_AUDIENCE", AUTH_JWT_AUDIENCE_DEFAULT)
    if audience.strip() == "":
        raise AuthJwtConfigurationError("AUTH_JWT_AUDIENCE cannot be blank.")
    return audience


def read_clock_skew_seconds(env: Mapping[str, str]) -> int:
    """Read the accepted shared JWT clock skew in seconds."""
    raw_clock_skew = env.get(
        "AUTH_JWT_CLOCK_SKEW_SECONDS",
        str(AUTH_JWT_CLOCK_SKEW_SECONDS_DEFAULT),
    )

    try:
        clock_skew_seconds = int(raw_clock_skew)
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_CLOCK_SKEW_SECONDS must be a non-negative integer."
        ) from error

    if clock_skew_seconds < 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_CLOCK_SKEW_SECONDS must be a non-negative integer."
        )

    return clock_skew_seconds


def read_jwks_timeout_seconds(env: Mapping[str, str]) -> int:
    """Read the issuer JWKS HTTP timeout in seconds."""
    try:
        timeout_seconds = int(
            env.get(
                "AUTH_JWT_JWKS_TIMEOUT_SECONDS",
                str(AUTH_JWT_JWKS_TIMEOUT_SECONDS_DEFAULT),
            )
        )
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_TIMEOUT_SECONDS must be a positive integer."
        ) from error

    if timeout_seconds <= 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_TIMEOUT_SECONDS must be a positive integer."
        )

    return timeout_seconds


def read_jwks_cache_ttl_seconds(env: Mapping[str, str]) -> float:
    """Read the JWKS cache TTL in seconds for URL-backed verifiers."""
    try:
        ttl_seconds = float(
            env.get(
                "AUTH_JWT_JWKS_CACHE_TTL_SECONDS",
                str(AUTH_JWT_JWKS_CACHE_TTL_SECONDS_DEFAULT),
            )
        )
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_CACHE_TTL_SECONDS must be a non-negative number."
        ) from error

    if ttl_seconds < 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_CACHE_TTL_SECONDS must be a non-negative number."
        )

    return ttl_seconds


def read_jwks_miss_refresh_cooldown_seconds(env: Mapping[str, str]) -> float:
    """Read the minimum seconds between unknown-kid JWKS refresh attempts."""
    try:
        cooldown_seconds = float(
            env.get(
                "AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS",
                str(AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS_DEFAULT),
            )
        )
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS must be a non-negative number."
        ) from error

    if cooldown_seconds < 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_MISS_REFRESH_COOLDOWN_SECONDS must be a non-negative number."
        )

    return cooldown_seconds


def read_jwks_startup_retries(env: Mapping[str, str]) -> int:
    """Read how many times startup should try loading JWKS URL config."""
    try:
        retries = int(
            env.get(
                "AUTH_JWT_JWKS_STARTUP_RETRIES",
                str(AUTH_JWT_JWKS_STARTUP_RETRIES_DEFAULT),
            )
        )
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_STARTUP_RETRIES must be a positive integer."
        ) from error

    if retries <= 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_STARTUP_RETRIES must be a positive integer."
        )

    return retries


def read_jwks_startup_backoff_seconds(env: Mapping[str, str]) -> float:
    """Read the startup JWKS retry backoff in seconds."""
    try:
        backoff_seconds = float(
            env.get(
                "AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS",
                str(AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS_DEFAULT),
            )
        )
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS must be a non-negative number."
        ) from error

    if backoff_seconds < 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_STARTUP_BACKOFF_SECONDS must be a non-negative number."
        )

    return backoff_seconds


def read_optional_jwks_url(env: Mapping[str, str]) -> str | None:
    """Read the optional issuer JWKS endpoint URL."""
    jwks_url = env.get("AUTH_JWT_JWKS_URL")
    if jwks_url is None or jwks_url.strip() == "":
        return None

    return jwks_url


def decode_jwks(raw_jwks: str) -> JsonWebKeySet:
    """Decode and validate one JWKS JSON document."""
    try:
        decoded_jwks = json.loads(raw_jwks)
        return JsonWebKeySet.model_validate(decoded_jwks)
    except (json.JSONDecodeError, ValidationError) as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_JSON or AUTH_JWT_JWKS_URL must provide a valid RS256 JWKS."
        ) from error


def fetch_and_validate_jwks_with_retries(
    jwks_url: str,
    timeout_seconds: int,
    startup_retries: int,
    startup_backoff_seconds: float,
) -> JsonWebKeySet:
    """Fetch startup JWKS config with bounded retry/backoff."""
    last_error: AuthJwtConfigurationError | None = None
    for attempt in range(startup_retries):
        try:
            return fetch_and_validate_jwks(jwks_url, timeout_seconds)
        except AuthJwtConfigurationError as error:
            last_error = error
            if attempt < startup_retries - 1 and startup_backoff_seconds > 0:
                time.sleep(startup_backoff_seconds)

    if last_error is not None:
        raise last_error
    raise AuthJwtConfigurationError("AUTH_JWT_JWKS_URL could not be loaded.")


def fetch_and_validate_jwks(jwks_url: str, timeout_seconds: int) -> JsonWebKeySet:
    """Fetch and validate the issuer JWKS document from the configured endpoint."""
    request = urllib.request.Request(jwks_url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return decode_jwks(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, UnicodeDecodeError) as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_JWKS_URL could not be loaded."
        ) from error


def build_public_keys_by_id(jwks: JsonWebKeySet) -> dict[str, Any]:
    """Convert the JWKS keys into verifier-ready public key objects by kid."""
    public_keys_by_id: dict[str, Any] = {}
    for public_jwk in jwks.keys:
        try:
            pyjwk = PyJWK.from_dict(public_jwk.model_dump())
        except (PyJWKError, ValueError, binascii.Error) as error:
            raise AuthJwtConfigurationError(
                "AUTH_JWT_JWKS_URL must expose valid RSA public keys."
            ) from error
        public_keys_by_id[public_jwk.kid] = pyjwk.key

    if len(public_keys_by_id) != len(jwks.keys):
        raise AuthJwtConfigurationError("JWKS key IDs must be unique.")

    return public_keys_by_id


def unauthorized() -> HTTPException:
    """Return a bounded authentication failure response."""
    return HTTPException(
        status_code=401,
        detail="Invalid or missing bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_auth_jwt_verifier(request: Request) -> AuthJwtVerifier:
    """Return the startup-validated shared JWT verifier."""
    verifier = getattr(request.app.state, "auth_jwt_verifier", None)
    if not isinstance(verifier, AuthJwtVerifier):
        raise AuthJwtConfigurationError("Shared JWT verifier is not configured.")
    return verifier


async def require_authenticated_identity(
    request: Request,
    verifier: Annotated[AuthJwtVerifier, Depends(get_auth_jwt_verifier)],
) -> AuthenticatedIdentity:
    """Require a valid shared bearer JWT for protected routes."""
    authorization = request.headers.get("authorization")
    if authorization is None:
        raise unauthorized()

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or token.strip() == "":
        raise unauthorized()

    return await verifier.verify_async(token)


async def require_request_context(
    request: Request,
    identity: Annotated[AuthenticatedIdentity, Depends(require_authenticated_identity)],
) -> AuthenticatedRequestContext:
    """Require a valid JWT and expose tenant, primary role, and all roles."""
    # Request middleware reads tenant context after the route finishes, so stash
    # the authenticated tenant on the request as soon as it is known.
    request.state.tenant_id = str(identity.tenant_id)
    request.state.role = select_primary_role(identity.roles)
    return AuthenticatedRequestContext(
        tenant_id=identity.tenant_id,
        role=select_primary_role(identity.roles),
        roles=identity.roles,
        service_permissions=identity.service_permissions,
    )


def claims_to_identity(claims: dict[str, Any]) -> AuthenticatedIdentity:
    """Validate JWT claims that have already passed cryptographic checks."""
    return AuthenticatedIdentity.model_validate(claims)


def select_primary_role(roles: list[RoleName]) -> RoleName:
    """Select the deterministic compatibility role for legacy single-role checks."""
    return min(roles, key=ROLE_PRECEDENCE.index)
