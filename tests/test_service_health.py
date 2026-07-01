import pytest
from httpx import ASGITransport, AsyncClient

from backend.python.main import app

@pytest.mark.anyio
async def test_health():
    # Arrange
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # Act
        response = await ac.get("/health")

    # Assert
    assert response.status_code == 200
    assert response.json() == {"status":"healthy", "message":"The service is live and healthy"}