from contextlib import asynccontextmanager
from typing import Annotated
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException

from .auth import (
    AuthJwtVerifier,
    AuthenticatedIdentity,
    AuthenticatedRequestContext,
    RoleName,
    require_authenticated_identity,
    require_request_context,
)
from .gl_coding import (
    GlCodingComputeRequest,
    GlCodingComputeResponse,
    GlAccountMappingRepository,
    code_line_items_to_gl_accounts,
)
from .gl_mapping_repository import PostgresGlAccountMappingRepository
from .service_health import ServiceHealth


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate shared JWT verifier configuration at application startup."""
    # Intentional fail-fast: a missing/invalid JWT public key config raises
    # AuthJwtConfigurationError here and prevents the app from starting at all.
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment()
    yield


app = FastAPI(lifespan=lifespan)

AP_REVIEW_GL_CODING_ROLES: frozenset[RoleName] = frozenset(
    {"Finance Admin", "Department Manager"}
)


async def require_ap_review_gl_coding_context(
    context: Annotated[AuthenticatedRequestContext, Depends(require_request_context)],
) -> AuthenticatedRequestContext:
    """Require a tenant-scoped internal role allowed to use AP Review GL coding."""
    if AP_REVIEW_GL_CODING_ROLES.isdisjoint(context.roles):
        raise HTTPException(
            status_code=403,
            detail="AP Review GL coding requires Finance Admin or Department Manager.",
        )

    return context


async def get_gl_account_mapping_repository() -> GlAccountMappingRepository:
    """Return the configured tenant-scoped GL account mapping repository."""
    return PostgresGlAccountMappingRepository.from_environment()


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


@app.post(
    "/gl-coding/line-items",
    response_model=GlCodingComputeResponse,
)
async def gl_coding_line_items(
    request: GlCodingComputeRequest,
    context: Annotated[
        AuthenticatedRequestContext,
        Depends(require_ap_review_gl_coding_context),
    ],
    mapping_repository: Annotated[
        GlAccountMappingRepository,
        Depends(get_gl_account_mapping_repository),
    ],
) -> GlCodingComputeResponse:
    """Return GL account coding results for AP Review line items."""
    return await code_line_items_to_gl_accounts(
        request, context.tenant_id, mapping_repository
    )


def main():
    """Run the local command-line entry point for the Python service."""
    print("Hello from expense-flow-project-team-3!")


if __name__ == "__main__":
    main()
