import base64
import os
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import InvalidTokenError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

AUTH_JWT_ISSUER_DEFAULT = "expenseflow-core-case-service"


class AuthenticatedIdentity(BaseModel):
    """Represent a validated tenant-scoped JWT identity."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(alias="sub")
    tenant_id: str
    roles: list[str]
    iss: str
    exp: int


class AuthJwtVerifier:
    """Verify shared RS256 JWTs issued by the Node service."""

    def __init__(self, environment: dict[str, str] | None = None) -> None:
        self._environment = environment if environment is not None else os.environ

    def verify(self, token: str) -> AuthenticatedIdentity:
        """Return identity claims after signature, issuer, and expiry validation."""
        try:
            payload = jwt.decode(
                token,
                self._load_public_key(),
                algorithms=["RS256"],
                issuer=self._issuer,
                options={"require": ["exp", "iss", "sub", "tenant_id", "roles"]},
            )
            return AuthenticatedIdentity.model_validate(payload)
        except (InvalidTokenError, ValidationError, ValueError) as error:
            raise unauthorized() from error

    @property
    def _issuer(self) -> str:
        issuer = self._environment.get("AUTH_JWT_ISSUER", AUTH_JWT_ISSUER_DEFAULT)
        if issuer.strip() == "":
            raise ValueError("AUTH_JWT_ISSUER cannot be blank.")
        return issuer

    def _load_public_key(self) -> str:
        encoded_public_key = self._environment.get("AUTH_JWT_PUBLIC_KEY_BASE64")
        if encoded_public_key is None or encoded_public_key.strip() == "":
            raise ValueError("AUTH_JWT_PUBLIC_KEY_BASE64 is required.")

        try:
            return base64.b64decode(encoded_public_key, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError(
                "AUTH_JWT_PUBLIC_KEY_BASE64 must be a base64 PEM RSA public key."
            ) from error


def unauthorized() -> HTTPException:
    """Return a bounded authentication failure response."""
    return HTTPException(
        status_code=401,
        detail="Invalid or missing bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_auth_jwt_verifier() -> AuthJwtVerifier:
    """Create a JWT verifier from the process environment."""
    return AuthJwtVerifier()


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
