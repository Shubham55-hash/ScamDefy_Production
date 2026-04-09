from fastapi.testclient import TestClient
from index import app

client = TestClient(app)

def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert "modules" in data
    assert "version" in data
