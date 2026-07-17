from contextlib import asynccontextmanager
from typing import Annotated
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI

from .auth import (
    AuthJwtVerifier,
    AuthenticatedIdentity,
    AuthenticatedRequestContext,
    require_authenticated_identity,
    require_request_context,
)
from .service_health import ServiceHealth


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate shared JWT verifier configuration at application startup."""
    # Intentional fail-fast: a missing/invalid JWT public key config raises
    # AuthJwtConfigurationError here and prevents the app from starting at all.
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    """Return a bounded health payload for deployment and smoke checks."""
    return ServiceHealth(status="healthy", message="The service is live and healthy")


@app.get(
    "/auth/me", response_model=AuthenticatedIdentity, response_model_by_alias=False
)
async def auth_me(
    identity: Annotated[AuthenticatedIdentity, Depends(require_authenticated_identity)],
) -> AuthenticatedIdentity:
    """Return the identity context from a validated shared JWT."""
    return identity


@app.get(
    "/auth/context",
    response_model=AuthenticatedRequestContext,
)
async def auth_context(
    context: Annotated[AuthenticatedRequestContext, Depends(require_request_context)],
) -> AuthenticatedRequestContext:
    """Return the trusted tenant and role request context."""
    return context


def main():
    """Run the local command-line entry point for the Python service."""
    print("Hello from expense-flow-project-team-3!")


if __name__ == "__main__":
    main()
