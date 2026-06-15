"""LingServer Dashboard — Alert Engine

Evaluates alert rules every 30s against system metrics.
Features: dedup (no re-fire while active), auto-recovery, webhook sending,
browser push via WebSocket broadcast.
"""
import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any

from server.models.database import get_db

# Track active alerts to prevent re-firing
# {rule_id: {"fired_at": ts, "value": x}}
_active_alerts: dict[int, dict] = {}

# Track when each rule first started violating (for duration-based firing)
# {rule_id: first_violation_timestamp}
_violation_start: dict[int, float] = {}


# ═══════════════════════════════════════════════════════════
#  Default rules
# ═══════════════════════════════════════════════════════════

DEFAULT_RULES = [
    {"name": "CPU 使用率过高", "metric": "cpu_percent", "condition": ">",
     "threshold": 90, "duration_seconds": 300, "enabled": 1, "action_type": "browser"},
    {"name": "内存使用率过高", "metric": "mem_percent", "condition": ">",
     "threshold": 95, "duration_seconds": 60, "enabled": 1, "action_type": "browser"},
    {"name": "磁盘使用率过高", "metric": "disk_percent", "condition": ">",
     "threshold": 85, "duration_seconds": 300, "enabled": 1, "action_type": "browser"},
]


def ensure_default_rules():
    """Create default alert rules if none exist."""
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0]
    if count == 0:
        for rule in DEFAULT_RULES:
            db.execute(
                """INSERT INTO alert_rules (name, metric, condition, threshold, duration_seconds, action_type, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (rule["name"], rule["metric"], rule["condition"],
                 rule["threshold"], rule["duration_seconds"], rule["action_type"], rule["enabled"]),
            )
        db.commit()


# ═══════════════════════════════════════════════════════════
#  Metrics snapshot
# ═══════════════════════════════════════════════════════════

_cpu_primed = False

async def _get_current_metrics() -> dict[str, float]:
    """Collect current system metrics (non-blocking via thread executor)."""
    import psutil

    global _cpu_primed
    # Prime psutil on first call so cpu_percent(interval=None) returns real values
    if not _cpu_primed:
        psutil.cpu_percent(interval=0.1)  # short blocking call, once
        _cpu_primed = True

    loop = asyncio.get_event_loop()

    def _collect():
        try:
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory().percent

            disks = []
            for part in psutil.disk_partitions():
                try:
                    disks.append(psutil.disk_usage(part.mountpoint).percent)
                except PermissionError:
                    pass
            disk = max(disks) if disks else 0

            return {"cpu_percent": cpu, "mem_percent": mem, "disk_percent": disk}
        except Exception:
            return {"cpu_percent": 0, "mem_percent": 0, "disk_percent": 0}

    return await loop.run_in_executor(None, _collect)


# ═══════════════════════════════════════════════════════════
#  Evaluation
# ═══════════════════════════════════════════════════════════

def _evaluate_condition(value: float, condition: str, threshold: float) -> bool:
    if condition == ">":
        return value > threshold
    elif condition == "<":
        return value < threshold
    elif condition == ">=":
        return value >= threshold
    elif condition == "<=":
        return value <= threshold
    elif condition == "=":
        return value == threshold
    return False


async def evaluate_rules():
    """Check all enabled rules against current metrics. Called every 30s."""
    now = time.time()
    metrics = await _get_current_metrics()
    if not metrics:
        return

    db = get_db()
    rules = db.execute(
        "SELECT * FROM alert_rules WHERE enabled = 1"
    ).fetchall()

    for rule in rules:
        rule_id = rule["id"]
        metric_key = rule["metric"]
        threshold = rule["threshold"]
        duration = rule["duration_seconds"]

        current_value = metrics.get(metric_key, 0)
        is_violating = _evaluate_condition(current_value, rule["condition"], threshold)

        if is_violating:
            # Record first violation time; fire if sustained past duration
            if rule_id not in _violation_start:
                _violation_start[rule_id] = now
            elif now - _violation_start[rule_id] >= duration:
                if rule_id not in _active_alerts:
                    await _fire_alert(rule, current_value)
        else:
            # Metric recovered — clear violation tracking and auto-recover
            _violation_start.pop(rule_id, None)
            if rule_id in _active_alerts:
                await _recover_alert(rule, current_value)


async def _fire_alert(rule: dict, actual_value: float):
    """Create alert history entry + broadcast + webhook."""
    now = datetime.now().isoformat()
    message = f"[{rule['name']}] {rule['metric']} {rule['condition']} {rule['threshold']} (当前: {actual_value:.1f})"

    db = get_db()
    cur = db.execute(
        """INSERT INTO alert_history (rule_id, rule_name, metric, threshold, actual_value, state, message, triggered_at)
           VALUES (?, ?, ?, ?, ?, 'fired', ?, ?)""",
        (rule["id"], rule["name"], rule["metric"], rule["threshold"], actual_value, message, now),
    )
    db.commit()

    alert_id = cur.lastrowid
    _active_alerts[rule["id"]] = {"fired_at": time.time(), "value": actual_value}

    # Browser push via WebSocket
    alert_data = {
        "type": "alert",
        "id": alert_id,
        "rule_name": rule["name"],
        "metric": rule["metric"],
        "threshold": rule["threshold"],
        "actual_value": actual_value,
        "message": message,
        "level": "critical",
    }
    from server.events import AlertEvent
    _event_bus = _get_event_bus()
    await _event_bus.publish(AlertEvent(
        rule_name=rule["name"],
        metric=rule["metric"],
        threshold=rule["threshold"],
        actual_value=actual_value,
        message=message,
        level="critical",
        alert_id=alert_id,
    ))

    # Webhook
    if rule["action_type"] == "webhook" and rule["action_config"]:
        await _send_webhook(rule["action_config"], alert_data)


async def _recover_alert(rule: dict, actual_value: float):
    """Mark alert as recovered."""
    now = datetime.now().isoformat()
    message = f"[{rule['name']}] 已恢复 (当前: {actual_value:.1f})"

    db = get_db()
    # Find the most recent fired alert for this rule
    alert = db.execute(
        """SELECT id FROM alert_history
           WHERE rule_id = ? AND state = 'fired'
           ORDER BY triggered_at DESC LIMIT 1""",
        (rule["id"],),
    ).fetchone()

    if alert:
        db.execute(
            "UPDATE alert_history SET state = 'recovered', recovered_at = ?, message = message || ' | ' || ? WHERE id = ?",
            (now, message, alert["id"]),
        )
        db.commit()

    _active_alerts.pop(rule["id"], None)

    # Browser push recovery
    from server.events import AlertEvent
    _event_bus = _get_event_bus()
    await _event_bus.publish(AlertEvent(
        rule_name=rule["name"],
        metric=rule["metric"],
        threshold=rule["threshold"],
        actual_value=actual_value,
        message=message,
        level="info",
    ))

    # Webhook for recovery too
    if rule["action_type"] == "webhook" and rule["action_config"]:
        await _send_webhook(rule["action_config"], {"type": "alert_recovered", "message": message})


async def _send_webhook(url: str, data: dict):
    """POST alert to webhook URL (fire-and-forget)."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, json=data)
    except Exception:
        pass  # Webhook failures are non-critical


# ═══════════════════════════════════════════════════════════
#  Background loop
# ═══════════════════════════════════════════════════════════

# EventBus instance — injected by main.py during app startup.
# Alert engine reads it lazily to avoid import-time coupling.
_event_bus = None


def set_event_bus(bus):
    """Called by main.py lifecycle to inject the EventBus singleton."""
    global _event_bus
    _event_bus = bus


def _get_event_bus():
    """Return the EventBus singleton, raising if not yet injected."""
    if _event_bus is None:
        raise RuntimeError("EventBus not injected — call set_event_bus() during startup")
    return _event_bus


async def alert_loop(interval: float = 30.0):
    """Run alert evaluation every `interval` seconds."""
    ensure_default_rules()
    while True:
        await asyncio.sleep(interval)
        try:
            await evaluate_rules()
        except Exception:
            logging.getLogger("ling.background").warning(
                "Alert evaluation failed", exc_info=True)
