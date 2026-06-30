from pydantic import BaseModel, StringConstraints
from typing import Annotated

class ServiceHealth(BaseModel):
    status: Annotated[str, StringConstraints(pattern="^(healthy)|(degraded)$")]
    message: Annotated[str, StringConstraints(max_length=100)]