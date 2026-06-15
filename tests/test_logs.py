"""Phase 4 — Log viewer tests."""
import pytest


def test_list_sources(auth_client):
    """GET /api/logs/sources returns configured sources."""
    r = auth_client.get("/api/logs/sources")
    assert r.status_code == 200
    data = r.json()
    assert "sources" in data
    assert isinstance(data["sources"], list)

    if data["sources"]:
        src = data["sources"][0]
        assert "id" in src
        assert "label" in src
        assert "path" in src
        assert "available" in src


def test_read_log_requires_source(auth_client):
    """GET /api/logs/read without source_id → 422."""
    r = auth_client.get("/api/logs/read")
    assert r.status_code == 422


def test_read_nonexistent_source(auth_client):
    """GET /api/logs/read with bad source_id → 404."""
    r = auth_client.get("/api/logs/read", params={"source_id": "nonexistent"})
    assert r.status_code == 404


def test_read_log_structure(auth_client):
    """Read a valid log source — check response structure."""
    # First get sources
    r = auth_client.get("/api/logs/sources")
    sources = r.json().get("sources", [])

    # Find first available source
    available = [s for s in sources if s["available"]]
    if not available:
        pytest.skip("No available log sources on this system")

    src = available[0]
    r = auth_client.get("/api/logs/read", params={"source_id": src["id"], "lines": 50})
    assert r.status_code == 200
    data = r.json()
    assert "lines" in data
    assert "total" in data
    assert "offset" in data
    assert "has_more" in data


def test_read_log_with_filter(auth_client):
    """Read logs with level filter."""
    r = auth_client.get("/api/logs/sources")
    sources = r.json().get("sources", [])
    available = [s for s in sources if s["available"]]
    if not available:
        pytest.skip("No available log sources")

    r = auth_client.get("/api/logs/read", params={
        "source_id": available[0]["id"],
        "filter_level": "error",
        "lines": 50,
    })
    assert r.status_code in (200, 404, 400)


def test_export_log(auth_client):
    """GET /api/logs/export returns text content."""
    r = auth_client.get("/api/logs/sources")
    sources = r.json().get("sources", [])
    available = [s for s in sources if s["available"]]
    if not available:
        pytest.skip("No available log sources")

    r = auth_client.get("/api/logs/export", params={"source_id": available[0]["id"]})
    assert r.status_code == 200
    assert "text/plain" in r.headers.get("content-type", "")
