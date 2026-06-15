"""LingServer Dashboard — Alert Routes

GET    /api/alerts/rules       — list rules
POST   /api/alerts/rules       — create rule
PUT    /api/alerts/rules/{id}  — update rule
DELETE /api/alerts/rules/{id}  — delete rule
GET    /api/alerts/history     — alert history (paginated)
POST   /api/alerts/{id}/acknowledge — acknowledge alert
"""
from fastapi import APIRouter, HTTPException, Query, Depends

from server.auth import get_current_user
from server.models.database import get_db
from server.services.alert_engine import _active_alerts

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


# ═══════════════════════════════════════════════════════════
#  Rules CRUD
# ═══════════════════════════════════════════════════════════

@router.get("/rules")
async def list_rules(_user=Depends(get_current_user)):
    """List all alert rules."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM alert_rules ORDER BY created_at DESC"
    ).fetchall()

    rules = []
    for r in rows:
        rules.append({
            "id": r["id"],
            "name": r["name"],
            "metric": r["metric"],
            "condition": r["condition"],
            "threshold": r["threshold"],
            "duration_seconds": r["duration_seconds"],
            "action_type": r["action_type"],
            "action_config": r["action_config"],
            "enabled": bool(r["enabled"]),
            "created_at": r["created_at"],
            "active": r["id"] in _active_alerts,
        })
    return {"rules": rules, "total": len(rules)}


@router.post("/rules")
async def create_rule(body: dict, _user=Depends(get_current_user)):
    """Create a new alert rule."""
    name = body.get("name", "").strip()
    metric = body.get("metric", "")
    condition = body.get("condition", ">")
    threshold = body.get("threshold", 0)
    duration = body.get("duration_seconds", 30)
    action_type = body.get("action_type", "browser")
    action_config = body.get("action_config", "")
    enabled = 1 if body.get("enabled", True) else 0

    if not name:
        raise HTTPException(400, "规则名称不能为空")
    if metric not in ("cpu_percent", "mem_percent", "disk_percent"):
        raise HTTPException(400, "metric 必须是 cpu_percent / mem_percent / disk_percent")
    if condition not in (">", "<", ">=", "<=", "="):
        raise HTTPException(400, "condition 无效")
    if not isinstance(threshold, (int, float)):
        raise HTTPException(400, "threshold 必须是数字")

    db = get_db()
    cur = db.execute(
        """INSERT INTO alert_rules (name, metric, condition, threshold, duration_seconds, action_type, action_config, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, metric, condition, threshold, duration, action_type, action_config, enabled),
    )
    db.commit()
    return {"success": True, "id": cur.lastrowid, "message": f"已创建规则: {name}"}


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: int, body: dict, _user=Depends(get_current_user)):
    """Update an alert rule."""
    db = get_db()
    existing = db.execute(
        "SELECT * FROM alert_rules WHERE id = ?", (rule_id,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "规则不存在")

    updates = {}
    for key in ("name", "metric", "condition", "threshold", "duration_seconds", "action_type", "action_config"):
        if key in body:
            updates[key] = body[key]
    if "enabled" in body:
        updates["enabled"] = 1 if body["enabled"] else 0

    if not updates:
        raise HTTPException(400, "无更新字段")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [rule_id]
    db.execute(f"UPDATE alert_rules SET {set_clause} WHERE id = ?", values)
    db.commit()

    # Clear active state so rule can re-fire
    _active_alerts.pop(rule_id, None)
    return {"success": True, "message": "规则已更新"}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, _user=Depends(get_current_user)):
    """Delete an alert rule and its history."""
    db = get_db()
    existing = db.execute(
        "SELECT id FROM alert_rules WHERE id = ?", (rule_id,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "规则不存在")

    db.execute("DELETE FROM alert_history WHERE rule_id = ?", (rule_id,))
    db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
    db.commit()

    _active_alerts.pop(rule_id, None)
    return {"success": True, "message": "规则已删除"}


# ═══════════════════════════════════════════════════════════
#  History
# ═══════════════════════════════════════════════════════════

@router.get("/history")
async def list_history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    state: str | None = Query(None),
    _user=Depends(get_current_user),
):
    """Paginated alert history."""
    db = get_db()

    where = ""
    params = []
    if state:
        where = "WHERE state = ?"
        params.append(state)

    count = db.execute(
        f"SELECT COUNT(*) FROM alert_history {where}", params
    ).fetchone()[0]

    offset = (page - 1) * size
    rows = db.execute(
        f"SELECT * FROM alert_history {where} ORDER BY triggered_at DESC LIMIT ? OFFSET ?",
        params + [size, offset],
    ).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "rule_id": r["rule_id"],
            "rule_name": r["rule_name"],
            "metric": r["metric"],
            "threshold": r["threshold"],
            "actual_value": r["actual_value"],
            "state": r["state"],
            "message": r["message"],
            "triggered_at": r["triggered_at"],
            "recovered_at": r["recovered_at"],
            "acknowledged_at": r["acknowledged_at"],
        })

    return {
        "items": items,
        "total": count,
        "page": page,
        "size": size,
        "pages": max(1, (count + size - 1) // size),
    }


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, _user=Depends(get_current_user)):
    """Mark an alert as acknowledged."""
    from datetime import datetime
    db = get_db()
    existing = db.execute(
        "SELECT id FROM alert_history WHERE id = ?", (alert_id,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "告警记录不存在")

    db.execute(
        "UPDATE alert_history SET state = 'acknowledged', acknowledged_at = ? WHERE id = ?",
        (datetime.now().isoformat(), alert_id),
    )
    db.commit()
    return {"success": True, "message": "告警已确认"}
