"""Phase 5 — Alert manager tests."""
import pytest


# ═══════════════════════════════════════════════════════════
#  Rules CRUD
# ═══════════════════════════════════════════════════════════

def test_list_rules(auth_client):
    """GET /api/alerts/rules returns rules (with defaults)."""
    r = auth_client.get("/api/alerts/rules")
    assert r.status_code == 200
    data = r.json()
    assert "rules" in data
    assert "total" in data
    # Default rules should have been created
    assert data["total"] >= 3


def test_create_rule(auth_client):
    """POST /api/alerts/rules creates a new rule."""
    r = auth_client.post("/api/alerts/rules", json={
        "name": "Test CPU Alert",
        "metric": "cpu_percent",
        "condition": ">",
        "threshold": 50,
        "duration_seconds": 30,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "id" in data


def test_create_rule_invalid_metric(auth_client):
    """Creating rule with bad metric returns 400."""
    r = auth_client.post("/api/alerts/rules", json={
        "name": "Bad",
        "metric": "invalid",
        "condition": ">",
        "threshold": 50,
    })
    assert r.status_code == 400


def test_update_rule(auth_client):
    """PUT /api/alerts/rules/{id} updates rule."""
    # Create first
    r = auth_client.post("/api/alerts/rules", json={
        "name": "Update Test",
        "metric": "cpu_percent",
        "condition": ">",
        "threshold": 80,
        "duration_seconds": 60,
    })
    rule_id = r.json()["id"]

    # Update
    r2 = auth_client.put(f"/api/alerts/rules/{rule_id}", json={
        "name": "Updated Name",
        "enabled": False,
    })
    assert r2.status_code == 200

    # Verify
    r3 = auth_client.get("/api/alerts/rules")
    rules = {r["id"]: r for r in r3.json()["rules"]}
    assert rules[rule_id]["name"] == "Updated Name"
    assert rules[rule_id]["enabled"] is False


def test_delete_rule(auth_client):
    """DELETE /api/alerts/rules/{id} removes rule."""
    r = auth_client.post("/api/alerts/rules", json={
        "name": "Delete Me",
        "metric": "mem_percent",
        "condition": ">",
        "threshold": 95,
    })
    rule_id = r.json()["id"]

    r2 = auth_client.delete(f"/api/alerts/rules/{rule_id}")
    assert r2.status_code == 200

    r3 = auth_client.get("/api/alerts/rules")
    ids = [r["id"] for r in r3.json()["rules"]]
    assert rule_id not in ids


# ═══════════════════════════════════════════════════════════
#  History
# ═══════════════════════════════════════════════════════════

def test_list_history(auth_client):
    """GET /api/alerts/history returns paginated history."""
    r = auth_client.get("/api/alerts/history")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert "pages" in data


def test_history_pagination(auth_client):
    """Pagination params work."""
    r = auth_client.get("/api/alerts/history", params={"page": 1, "size": 5})
    assert r.status_code == 200
    data = r.json()
    assert data["size"] == 5


def test_history_state_filter(auth_client):
    """Filter history by state."""
    r = auth_client.get("/api/alerts/history", params={"state": "fired"})
    assert r.status_code == 200


def test_acknowledge_nonexistent(auth_client):
    """Acknowledge nonexistent alert returns 404."""
    r = auth_client.post("/api/alerts/99999/acknowledge")
    assert r.status_code == 404
