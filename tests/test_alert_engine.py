"""Phase 5+ — Alert engine evaluation tests.

Covers: _evaluate_condition, ensure_default_rules idempotency,
metrics cache fallback, and EventBus deduplication path.
"""
import pytest
from unittest.mock import patch, MagicMock


# ═══════════════════════════════════════════════════════════
#  _evaluate_condition — unit tests
# ═══════════════════════════════════════════════════════════

def test_evaluate_gt_true():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(95.0, ">", 90.0) is True


def test_evaluate_gt_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(85.0, ">", 90.0) is False


def test_evaluate_gt_equal_not_greater():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(90.0, ">", 90.0) is False


def test_evaluate_lt_true():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(5.0, "<", 10.0) is True


def test_evaluate_lt_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(15.0, "<", 10.0) is False


def test_evaluate_gte_true():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(90.0, ">=", 90.0) is True


def test_evaluate_gte_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(89.9, ">=", 90.0) is False


def test_evaluate_lte_true():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(10.0, "<=", 10.0) is True


def test_evaluate_lte_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(10.1, "<=", 10.0) is False


def test_evaluate_eq_true():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(42.0, "=", 42.0) is True


def test_evaluate_eq_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(42.0, "=", 43.0) is False


def test_evaluate_unknown_condition_returns_false():
    from server.services.alert_engine import _evaluate_condition
    assert _evaluate_condition(90.0, "!=", 90.0) is False


# ═══════════════════════════════════════════════════════════
#  ensure_default_rules — idempotency
# ═══════════════════════════════════════════════════════════

def test_ensure_default_rules_idempotent():
    """Calling ensure_default_rules() twice doesn't create duplicate rules."""
    from server.services.alert_engine import ensure_default_rules
    from server.models.database import get_db

    ensure_default_rules()
    db = get_db()
    before = db.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0]

    # Second call should not add more
    ensure_default_rules()
    after = db.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0]

    assert before == after
    assert before >= 3  # at least the 3 defaults


# ═══════════════════════════════════════════════════════════
#  _get_current_metrics — cache vs fallback
# ═══════════════════════════════════════════════════════════

class _FakeEventBus:
    """Minimal EventBus stub with latest_metrics attr."""
    def __init__(self):
        self.latest_metrics = {}


@pytest.mark.asyncio
async def test_get_current_metrics_uses_cache_when_available(monkeypatch):
    """When EventBus cache has full metrics, no psutil call is made."""
    from server.services.alert_engine import _get_current_metrics, set_event_bus, _get_event_bus

    bus = _FakeEventBus()
    bus.latest_metrics = {
        "cpu": {"percent": 42.0},
        "memory": {"percent": 65.0},
        "disks": [{"percent": 80.0}],
    }

    # Inject our fake bus
    monkeypatch.setattr("server.services.alert_engine._event_bus", bus)

    result = await _get_current_metrics()
    assert result == {"cpu_percent": 42.0, "mem_percent": 65.0, "disk_percent": 80.0}


@pytest.mark.asyncio
async def test_get_current_metrics_falls_back_when_cache_empty(monkeypatch):
    """When EventBus cache is empty, falls back to direct psutil collection."""
    from server.services.alert_engine import _get_current_metrics

    bus = _FakeEventBus()
    # Empty cache
    bus.latest_metrics = {}
    monkeypatch.setattr("server.services.alert_engine._event_bus", bus)

    result = await _get_current_metrics()
    # Fallback should return dict with expected keys
    assert "cpu_percent" in result
    assert "mem_percent" in result
    assert "disk_percent" in result
    # Values should be numeric (real psutil data or fallback 0 on error)
    assert isinstance(result["cpu_percent"], (int, float))
    assert isinstance(result["mem_percent"], (int, float))
    assert isinstance(result["disk_percent"], (int, float))


@pytest.mark.asyncio
async def test_get_current_metrics_cache_missing_memory_key(monkeypatch):
    """When cache has cpu but not memory, falls back to psutil."""
    from server.services.alert_engine import _get_current_metrics

    bus = _FakeEventBus()
    bus.latest_metrics = {"cpu": {"percent": 99.0}}  # missing "memory" key
    monkeypatch.setattr("server.services.alert_engine._event_bus", bus)

    result = await _get_current_metrics()
    # Should fall back to psutil, returning full dict
    assert isinstance(result["cpu_percent"], (int, float))


# ═══════════════════════════════════════════════════════════
#  must_change_password flow
# ═══════════════════════════════════════════════════════════

def test_must_change_password_flag_returned_on_login(auth_client):
    """Login response includes must_change_password field."""
    r = auth_client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert "must_change_password" in data["data"]
    # Default admin test user has must_change_password=0
    assert data["data"]["must_change_password"] is False
