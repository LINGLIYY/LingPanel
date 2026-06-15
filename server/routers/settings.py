"""LingServer Dashboard — Settings Routes

GET  /api/settings        — read all settings (key-value)
PUT  /api/settings        — update settings (batch)
GET  /api/settings/stats  — audit table record counts
"""

from fastapi import APIRouter, Request, HTTPException, Depends
from server.auth import get_current_user
from server.models.database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Whitelist of keys that can be updated via PUT
_ALLOWED_KEYS = {
    "refresh_interval",
    "retention_days",
    "terminal_timeout",
    "debug_panel",
    "alert_cpu",
    "alert_mem",
    "alert_disk",
    "alert_duration",
    "alert_action",
    "dark_background",
    "light_background",
}


@router.get("")
async def get_settings(_user=Depends(get_current_user)):
    """Return all settings as a flat key-value dict."""
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings ORDER BY key").fetchall()
    return {row["key"]: row["value"] for row in rows}


@router.put("")
async def update_settings(request: Request, _user=Depends(get_current_user)):
    """Update one or more settings. Only whitelisted keys are accepted."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "请求体必须为 JSON 对象")

    updates = {}
    for key, value in body.items():
        if key not in _ALLOWED_KEYS:
            raise HTTPException(400, f"不允许修改的配置项: {key}")
        updates[key] = str(value)

    if not updates:
        raise HTTPException(400, "无可更新的配置项")

    db = get_db()
    for key, value in updates.items():
        db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value),
        )
    db.commit()

    return {"success": True, "updated": list(updates.keys())}


@router.get("/stats")
async def audit_stats(_user=Depends(get_current_user)):
    """Return record counts for all audit/history tables (single query)."""
    db = get_db()
    tables = [
        ("terminal_audit", "终端命令"),
        ("login_audit", "登录记录"),
        ("alert_history", "告警历史"),
        ("metrics_history", "指标历史"),
    ]
    query = " UNION ALL ".join(
        f"SELECT '{t}' as tbl, COUNT(*) as cnt FROM {t}" for t, _ in tables
    )
    try:
        rows = db.execute(query).fetchall()
        return {
            row["tbl"]: {"label": label, "count": row["cnt"]}
            for row, (_, label) in zip(rows, tables)
        }
    except Exception:
        return {t: {"label": l, "count": 0} for t, l in tables}
