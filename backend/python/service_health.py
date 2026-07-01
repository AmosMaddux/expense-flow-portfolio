from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints


class ServiceHealth(BaseModel):
    """Expose a bounded health message for service readiness checks."""

    status: Literal["healthy", "degraded"]
    message: Annotated[str, StringConstraints(max_length=100)]
