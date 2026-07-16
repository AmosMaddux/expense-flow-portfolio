import base64
import json
import os
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Mapping
from uuid import UUID

import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from fastapi import Depends, HTTPException, Request
from jwt import InvalidTokenError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

AUTH_JWT_ISSUER_DEFAULT = "expenseflow-core-case-service"
AUTH_JWT_CLOCK_SKEW_SECONDS_DEFAULT = 10

# Mirrors backend/core-case-service/src/db/schema/identityAuth.ts roleValues.
RoleName = Literal[
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]


class AuthJwtConfigurationError(RuntimeError):
    """Report invalid shared JWT verifier configuration."""


class AuthenticatedIdentity(BaseModel):
    """Represent a validated tenant-scoped JWT identity."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: UUID = Field(alias="sub")
    tenant_id: UUID
    roles: list[RoleName] = Field(min_length=1)
    iss: str
    iat: int
    exp: int
    token_use: Literal["access"]


@dataclass(frozen=True)
class AuthJwtVerifierConfig:
    """Hold validated shared JWT verifier settings."""

    issuer: str
    public_keys_by_id: dict[str, str]
    single_key_id: str | None
    clock_skew_seconds: int


class AuthJwtVerifier:
    """Verify shared RS256 JWTs issued by the Node service."""

    def __init__(self, config: AuthJwtVerifierConfig) -> None:
        self._config = config

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str] | None = None
    ) -> "AuthJwtVerifier":
        """Create a verifier from validated process environment settings."""
        return cls(load_auth_jwt_verifier_config(environment))

    def verify(self, token: str) -> AuthenticatedIdentity:
        """Return identity claims after signature, issuer, and expiry validation."""
        try:
            key = self._select_public_key(token)
            payload = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=self._config.issuer,
                leeway=self._config.clock_skew_seconds,
                options={
                    "require": [
                        "exp",
                        "iat",
                        "iss",
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

    def _select_public_key(self, token: str) -> str:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")

        if not isinstance(key_id, str) or key_id.strip() == "":
            if self._config.single_key_id is not None:
                return self._config.public_keys_by_id[self._config.single_key_id]
            raise unauthorized()

        public_key = self._config.public_keys_by_id.get(key_id)
        if public_key is None:
            raise unauthorized()

        return public_key


def load_auth_jwt_verifier_config(
    environment: Mapping[str, str] | None = None,
) -> AuthJwtVerifierConfig:
    """Read and validate shared JWT verifier settings."""
    env = environment if environment is not None else os.environ
    issuer = read_issuer(env)
    clock_skew_seconds = read_clock_skew_seconds(env)
    public_keys_by_id = read_public_keys_by_id(env)
    single_key_id = (
        next(iter(public_keys_by_id)) if len(public_keys_by_id) == 1 else None
    )

    return AuthJwtVerifierConfig(
        issuer=issuer,
        public_keys_by_id=public_keys_by_id,
        single_key_id=single_key_id,
        clock_skew_seconds=clock_skew_seconds,
    )


def read_issuer(env: Mapping[str, str]) -> str:
    """Read the expected shared JWT issuer."""
    issuer = env.get("AUTH_JWT_ISSUER", AUTH_JWT_ISSUER_DEFAULT)
    if issuer.strip() == "":
        raise AuthJwtConfigurationError("AUTH_JWT_ISSUER cannot be blank.")
    return issuer


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


def read_public_keys_by_id(env: Mapping[str, str]) -> dict[str, str]:
    """Read shared JWT public keys by key identifier."""
    encoded_public_keys = env.get("AUTH_JWT_PUBLIC_KEYS_JSON")
    if encoded_public_keys is not None and encoded_public_keys.strip() != "":
        return decode_public_keys_json(encoded_public_keys)

    encoded_public_key = env.get("AUTH_JWT_PUBLIC_KEY_BASE64")
    if encoded_public_key is None or encoded_public_key.strip() == "":
        raise AuthJwtConfigurationError(
            "AUTH_JWT_PUBLIC_KEYS_JSON or AUTH_JWT_PUBLIC_KEY_BASE64 is required."
        )

    key_id = env.get("AUTH_JWT_KEY_ID", "default")
    if key_id.strip() == "":
        raise AuthJwtConfigurationError("AUTH_JWT_KEY_ID cannot be blank.")

    return {key_id: decode_public_key(encoded_public_key)}


def decode_public_keys_json(encoded_public_keys: str) -> dict[str, str]:
    """Decode a JSON object mapping JWT key IDs to base64 PEM public keys."""
    try:
        raw_public_keys = json.loads(encoded_public_keys)
    except json.JSONDecodeError as error:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_PUBLIC_KEYS_JSON must be a JSON object."
        ) from error

    if not isinstance(raw_public_keys, dict) or len(raw_public_keys) == 0:
        raise AuthJwtConfigurationError(
            "AUTH_JWT_PUBLIC_KEYS_JSON must be a non-empty JSON object."
        )

    public_keys_by_id: dict[str, str] = {}
    for key_id, encoded_public_key in raw_public_keys.items():
        if not isinstance(key_id, str) or key_id.strip() == "":
            raise AuthJwtConfigurationError(
                "AUTH_JWT_PUBLIC_KEYS_JSON key IDs must be non-empty strings."
            )
        if not isinstance(encoded_public_key, str):
            raise AuthJwtConfigurationError(
                "AUTH_JWT_PUBLIC_KEYS_JSON values must be base64 PEM public keys."
            )
        public_keys_by_id[key_id] = decode_public_key(encoded_public_key)

    return public_keys_by_id


def decode_public_key(encoded_public_key: str) -> str:
    """Decode one base64 PEM RSA public key."""
    try:
        decoded_key = base64.b64decode(encoded_public_key, validate=True).decode(
            "utf-8"
        )
    except (ValueError, UnicodeDecodeError) as error:
        raise AuthJwtConfigurationError(
            "JWT public keys must be base64 PEM RSA public keys."
        ) from error

    try:
        public_key = load_pem_public_key(decoded_key.encode("utf-8"))
    except ValueError as error:
        raise AuthJwtConfigurationError(
            "JWT public keys must be base64 PEM RSA public keys."
        ) from error

    if not isinstance(public_key, RSAPublicKey):
        raise AuthJwtConfigurationError(
            "JWT public keys must be base64 PEM RSA public keys."
        )

    return decoded_key


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

    return verifier.verify(token)


def claims_to_identity(claims: dict[str, Any]) -> AuthenticatedIdentity:
    """Validate JWT claims that have already passed cryptographic checks."""
    return AuthenticatedIdentity.model_validate(claims)
