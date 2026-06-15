"""LingServer Dashboard — Service Management Routes

GET   /api/services             — list service statuses (systemctl)
POST  /api/services/{name}/{action} — start/stop/restart a service
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException, Depends

from server.auth import get_current_user

# Whitelist of manageable services
SERVICES = ["nginx", "docker", "mysql", "redis-server", "ssh", "cron"]

router = APIRouter(prefix="/api/services", tags=["services"])


def _check_one(svc: str) -> dict:
    """Check a single service status (runs in thread pool)."""
    try:
        r = subprocess.run(["systemctl", "is-active", svc],
                           capture_output=True, text=True, timeout=3)
        return {"name": svc, "status": r.stdout.strip()}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"name": svc, "status": "unknown"}


@router.get("")
async def service_status(_user=Depends(get_current_user)):
    # Check all services in parallel — each subprocess is independent
    with ThreadPoolExecutor(max_workers=len(SERVICES)) as pool:
        results = list(pool.map(_check_one, SERVICES))
    return {"services": results}


@router.post("/{name}/{action}")
async def service_action(name: str, action: str, _user=Depends(get_current_user)):
    """Start/stop/restart a systemd service."""
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail=f"无效操作: {action}")
    if name not in SERVICES:
        raise HTTPException(status_code=404, detail=f"服务 {name} 不在白名单中")
    try:
        r = subprocess.run(
            ["systemctl", action, name],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode != 0:
            raise HTTPException(status_code=500, detail=r.stderr.strip() or f"systemctl {action} {name} 失败")
        return {"status": "ok", "name": name, "action": action, "result": r.stdout.strip()}
    except FileNotFoundError:
        raise HTTPException(status_code=501, detail="systemctl 不可用")
