"""LingServer Dashboard — Process Management Routes

GET    /api/processes        — list processes (sorted, paginated)
DELETE /api/processes/{pid}  — terminate a process
"""
import psutil
from fastapi import APIRouter, HTTPException, Depends

from server.auth import get_current_user

router = APIRouter(prefix="/api/processes", tags=["processes"])


@router.get("")
async def process_list(limit: int = 50, sort: str = "cpu", _user=Depends(get_current_user)):
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent",
                                   "status", "username"]):
        try:
            info = p.info
            procs.append({
                "pid": info["pid"], "name": info["name"] or "?",
                "cpu_percent": info["cpu_percent"] or 0,
                "memory_percent": round(info["memory_percent"] or 0, 1),
                "status": info["status"],
                "username": info["username"] or "?",
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    key = "cpu_percent" if sort == "cpu" else "memory_percent"
    procs.sort(key=lambda x: x[key], reverse=True)
    return {"processes": procs[:limit], "total": len(procs)}


@router.delete("/{pid}")
async def process_kill(pid: int, _user=Depends(get_current_user)):
    try:
        proc = psutil.Process(pid)
        proc.terminate()
        return {"status": "ok", "pid": pid, "name": proc.name()}
    except psutil.NoSuchProcess:
        raise HTTPException(status_code=404, detail=f"进程 {pid} 不存在")
    except psutil.AccessDenied:
        raise HTTPException(status_code=403, detail=f"无权终止进程 {pid}")
