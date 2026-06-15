"""Phase 3 — Docker service tests.

On systems without Docker, endpoints should return 503 gracefully.
"""
import pytest


def test_docker_info_responds(auth_client):
    """GET /api/docker should return info (or 503 if Docker unavailable)."""
    r = auth_client.get("/api/docker")
    # Accept either 200 (Docker available) or 503 (graceful degradation)
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        data = r.json()
        assert "available" in data
        # Could be True or False — both are valid responses
    else:
        assert "Docker" in r.json()["detail"]


def test_docker_containers_graceful(auth_client):
    """GET /api/docker/containers returns 503 when Docker unavailable."""
    r = auth_client.get("/api/docker/containers")
    # 200 if Docker available, 503 if not
    assert r.status_code in (200, 503)
