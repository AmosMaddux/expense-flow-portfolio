from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from starlette.requests import Request

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
    get_mileage_reimbursement_rate,
)
from .gl_mapping_repository import PostgresGlAccountMappingRepository
from .observability import (
    initialize_tracing,
    log_metric,
    log_service_event,
    request_metrics_middleware,
    request_tracing_middleware,
)
from .service_health import ServiceHealth


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate shared service configuration at application startup."""
    # Intentional fail-fast: a missing/invalid JWT public key config raises
    # AuthJwtConfigurationError here and prevents the app from starting at all.
    app.state.auth_jwt_verifier = AuthJwtVerifier.from_environment()
    app.state.mileage_reimbursement_rate = get_mileage_reimbursement_rate()
    initialize_tracing("gl-coding-service")
    yield


app = FastAPI(lifespan=lifespan)
app.middleware("http")(request_metrics_middleware("gl-coding-service"))
app.middleware("http")(request_tracing_middleware("gl-coding-service"))

AP_REVIEW_GL_CODING_ROLES: frozenset[RoleName] = frozenset(
    {"Finance Admin", "Department Manager"}
)
EXPENSE_REPORT_SUBMIT_PERMISSION = "expense-report:submit"


async def require_ap_review_gl_coding_context(
    context: Annotated[AuthenticatedRequestContext, Depends(require_request_context)],
) -> AuthenticatedRequestContext:
    """Require a tenant-scoped internal role allowed to use AP Review GL coding."""
    has_submission_permission = (
        EXPENSE_REPORT_SUBMIT_PERMISSION in context.service_permissions
    )
    if (
        AP_REVIEW_GL_CODING_ROLES.isdisjoint(context.roles)
        and not has_submission_permission
    ):
        raise HTTPException(
            status_code=403,
            detail="GL coding requires an internal reviewer or Expense Report submission permission.",
        )

    return context


async def get_gl_account_mapping_repository() -> GlAccountMappingRepository:
    """Return the configured tenant-scoped GL account mapping repository."""
    return PostgresGlAccountMappingRepository.from_environment()


async def get_configured_mileage_reimbursement_rate(request: Request) -> Decimal:
    """Return the startup-validated mileage reimbursement rate."""
    rate = getattr(request.app.state, "mileage_reimbursement_rate", None)
    if not isinstance(rate, Decimal):
        raise RuntimeError("Mileage reimbursement rate is not configured.")
    return rate


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
    mileage_reimbursement_rate: Annotated[
        Decimal,
        Depends(get_configured_mileage_reimbursement_rate),
    ],
) -> GlCodingComputeResponse:
    """Return GL account coding results for AP Review line items."""
    try:
        response = await code_line_items_to_gl_accounts(
            request,
            context.tenant_id,
            mapping_repository,
            mileage_reimbursement_rate,
        )
        log_metric(
            service="gl-coding-service",
            event_type="gl_coding_request",
            metric_name="GlCodingRequestCount",
            tenant_id=str(context.tenant_id),
            outcome="success",
        )
        return response
    except Exception:
        log_metric(
            service="gl-coding-service",
            event_type="gl_coding_request",
            metric_name="GlCodingErrorCount",
            tenant_id=str(context.tenant_id),
            outcome="error",
        )
        raise


def main():
    """Run the local command-line entry point for the Python service."""
    log_service_event(
        service="gl-coding-service",
        eventType="service_startup",
        outcome="success",
    )


if __name__ == "__main__":
    main()
