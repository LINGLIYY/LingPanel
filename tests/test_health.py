"""Phase 1-2 — Health check and system endpoint tests."""


def test_health_ok(client):
    """GET /api/health returns 200 with status ok (public)."""
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["version"] == "2.0.0"


def test_index_html(client):
    """GET / returns index.html (public)."""
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_api_system_requires_auth(client):
    """GET /api/system returns 401 without auth."""
    r = client.get("/api/system")
    assert r.status_code == 401


def test_api_system_with_auth(auth_client):
    """GET /api/system returns data when authenticated."""
    r = auth_client.get("/api/system")
    assert r.status_code == 200
    data = r.json()
    assert "hostname" in data
    assert "cpu" in data
    assert "memory" in data
    assert "uptime_seconds" in data
    assert "ts" in data
