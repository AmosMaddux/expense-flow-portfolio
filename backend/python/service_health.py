from pydantic import BaseModel, StringConstraints
from typing import Annotated, Literal

class ServiceHealth(BaseModel):
    status: Literal["healthy", "degraded"]
    message: Annotated[str, StringConstraints(max_length=100)]