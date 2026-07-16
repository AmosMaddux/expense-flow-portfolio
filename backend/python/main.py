from typing import Annotated

from fastapi import Depends, FastAPI

from .auth import AuthenticatedIdentity, require_authenticated_identity
from .service_health import ServiceHealth

app = FastAPI()


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


def main():
    """Run the local command-line entry point for the Python service."""
    print("Hello from expense-flow-project-team-3!")


if __name__ == "__main__":
    main()
