"""LingServer Dashboard — System Routes

GET  /api/system   — system info (CPU/Mem/Disk/Net)
WS   /ws/live      — real-time metrics push
"""
import asyncio
import time
import os
import socket
import platform

import psutil
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.ws import manager

router = APIRouter(tags=["system"])
_ws_router = APIRouter(tags=["ws"])

BOOT_TIME = psutil.boot_time()
_net_last: dict = {"bytes_sent": 0, "bytes_recv": 0, "ts": 0}


def _collect_system() -> dict:
    """Collect current system metrics. Called both by REST and WS."""
    global _net_last

    cpu = psutil.cpu_percent(interval=None)
    cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # Disks
    disks = []
    for part in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "device": part.device, "mount": part.mountpoint,
                "fstype": part.fstype,
                "total_gb": round(usage.total / (1024**3), 1),
                "used_gb": round(usage.used / (1024**3), 1),
                "free_gb": round(usage.free / (1024**3), 1),
                "percent": usage.percent,
            })
        except PermissionError:
            pass

    # Network speed
    net = psutil.net_io_counters()
    now_ts = time.time()
    if _net_last["ts"] > 0:
        elapsed = now_ts - _net_last["ts"]
        down_speed = (net.bytes_recv - _net_last["bytes_recv"]) / elapsed / 1024
        up_speed = (net.bytes_sent - _net_last["bytes_sent"]) / elapsed / 1024
    else:
        down_speed = up_speed = 0
    _net_last = {"bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv, "ts": now_ts}

    load = os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0)

    return {
        "hostname": socket.gethostname(),
        "ts": int(now_ts),
        "uptime_seconds": int(time.time() - BOOT_TIME),
        "cpu": {
            "percent": cpu,
            "cores": psutil.cpu_count(logical=False),
            "threads": psutil.cpu_count(logical=True),
            "per_core": cpu_per_core,
            "load_avg": {"1min": round(load[0], 2), "5min": round(load[1], 2), "15min": round(load[2], 2)},
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 1),
            "used_gb": round(mem.used / (1024**3), 1),
            "available_gb": round(mem.available / (1024**3), 1),
            "percent": mem.percent,
        },
        "swap": {
            "total_gb": round(swap.total / (1024**3), 1),
            "used_gb": round(swap.used / (1024**3), 1),
            "percent": swap.percent,
        } if swap.total > 0 else None,
        "disks": disks,
        "network": {
            "speed_down_kbs": round(down_speed, 1),
            "speed_up_kbs": round(up_speed, 1),
            "total_down_gb": round(net.bytes_recv / (1024**3), 2),
            "total_up_gb": round(net.bytes_sent / (1024**3), 2),
        },
    }


# ── REST endpoint (authenticated in main.py) ──

@router.get("/api/system")
async def system_info():
    """Return real-time system metrics."""
    return _collect_system()


# ── WebSocket endpoint ──

@_ws_router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    # ── Authenticate ──
    await ws.accept()
    try:
        from server.auth import verify_ws_auth
        verify_ws_auth(ws)
    except Exception:
        await ws.close(code=4001, reason="Unauthorized")
        return

    conn_id = await manager.connect(ws)

    try:
        # Handle subscription message
        raw = await ws.receive_text()
        import json
        try:
            msg = json.loads(raw)
            channels = msg.get("channels", ["system"])
        except json.JSONDecodeError:
            channels = ["system"]

        manager.subscribe(conn_id, channels)

        # Push loop — 1s interval
        while True:
            try:
                data = _collect_system()
                data["type"] = "metric"
                await ws.send_json(data)
                await asyncio.sleep(1)
            except WebSocketDisconnect:
                break
            except Exception:
                await asyncio.sleep(1)

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(conn_id)
