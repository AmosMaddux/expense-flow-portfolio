import pytest
from httpx import ASGITransport, AsyncClient

from backend.python.main import app

@pytest.mark.anyio
async def test_health():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "message": "The service is live and healthy",
    }
