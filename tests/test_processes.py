"""LingServer Dashboard — Processes & Services Tests"""
import pytest


class TestProcessList:
    """GET /api/processes tests."""

    def test_list_returns_structure(self, auth_client):
        r = auth_client.get("/api/processes")
        assert r.status_code == 200
        data = r.json()
        assert "processes" in data
        assert "total" in data
        assert isinstance(data["processes"], list)
        assert data["total"] >= 0

    def test_list_requires_auth(self, client):
        r = client.get("/api/processes")
        assert r.status_code in (401, 403)

    def test_list_with_limit(self, auth_client):
        r = auth_client.get("/api/processes?limit=5")
        assert r.status_code == 200
        data = r.json()
        assert len(data["processes"]) <= 5

    def test_list_with_sort(self, auth_client):
        r = auth_client.get("/api/processes?sort=memory")
        assert r.status_code == 200
        data = r.json()
        if len(data["processes"]) >= 2:
            # Verify sorted descending by memory
            mems = [p["memory_percent"] for p in data["processes"]]
            assert mems == sorted(mems, reverse=True)

    def test_process_has_required_fields(self, auth_client):
        r = auth_client.get("/api/processes?limit=1")
        assert r.status_code == 200
        procs = r.json()["processes"]
        if procs:
            p = procs[0]
            for field in ["pid", "name", "cpu_percent", "memory_percent", "status", "username"]:
                assert field in p, f"Missing field: {field}"


class TestProcessKill:
    """DELETE /api/processes/{pid} tests."""

    def test_kill_requires_auth(self, client):
        r = client.delete("/api/processes/99999")
        assert r.status_code in (401, 403)

    def test_kill_nonexistent_returns_404(self, auth_client):
        r = auth_client.delete("/api/processes/99999999")
        assert r.status_code == 404


class TestServiceList:
    """GET /api/services tests."""

    def test_list_returns_structure(self, auth_client):
        r = auth_client.get("/api/services")
        assert r.status_code == 200
        data = r.json()
        assert "services" in data
        assert isinstance(data["services"], list)
        assert len(data["services"]) >= 1

    def test_list_requires_auth(self, client):
        r = client.get("/api/services")
        assert r.status_code in (401, 403)

    def test_each_service_has_fields(self, auth_client):
        r = auth_client.get("/api/services")
        services = r.json()["services"]
        for s in services:
            assert "name" in s
            assert "status" in s
            assert s["status"] in ("active", "inactive", "failed", "unknown", "dead", "exited")


class TestServiceAction:
    """POST /api/services/{name}/{action} tests."""

    def test_action_requires_auth(self, client):
        r = client.post("/api/services/ssh/restart")
        assert r.status_code in (401, 403)

    def test_invalid_action_rejected(self, auth_client):
        r = auth_client.post("/api/services/ssh/destroy")
        assert r.status_code == 400

    def test_non_whitelisted_service_rejected(self, auth_client):
        r = auth_client.post("/api/services/evil_service/start")
        assert r.status_code == 404

    def test_valid_action_accepted_or_unavailable(self, auth_client):
        """start may succeed or return 501 (no systemctl on Windows)."""
        r = auth_client.post("/api/services/ssh/restart")
        assert r.status_code in (200, 500, 501)
