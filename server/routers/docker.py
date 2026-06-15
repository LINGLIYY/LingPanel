"""LingServer Dashboard — Docker Routes

GET    /api/docker             — Docker info
GET    /api/docker/containers  — list containers
POST   /api/docker/containers/{id}/start  — start container
POST   /api/docker/containers/{id}/stop   — stop container
GET    /api/docker/containers/{id}/logs   — container logs
GET    /api/docker/images       — list images
"""
from fastapi import APIRouter, HTTPException, Depends

from server.auth import get_current_user
from server.services import docker_svc

router = APIRouter(prefix="/api/docker", tags=["docker"])


def _check_docker():
    """Raise 503 if Docker is unavailable."""
    if not docker_svc.is_available():
        raise HTTPException(503, "Docker 不可用 — socket 无法连接")


# ═══════════════════════════════════════════════════════════
#  Info
# ═══════════════════════════════════════════════════════════

@router.get("")
async def docker_info(_user=Depends(get_current_user)):
    """Docker daemon info and health. Returns 503 if Docker socket unreachable."""
    _check_docker()
    return docker_svc.docker_info()


@router.get("/info")
async def docker_info_alias(_user=Depends(get_current_user)):
    """Alias for GET /api/docker — Docker daemon info."""
    _check_docker()
    return docker_svc.docker_info()


# ═══════════════════════════════════════════════════════════
#  Containers
# ═══════════════════════════════════════════════════════════

@router.get("/containers")
async def list_containers(all: bool = True, _user=Depends(get_current_user)):
    """List all containers with stats."""
    _check_docker()
    containers = docker_svc.list_containers(all=all)
    return {"containers": containers, "total": len(containers)}


@router.post("/containers/{container_id}/start")
async def start_container(container_id: str, _user=Depends(get_current_user)):
    """Start a container."""
    _check_docker()
    try:
        result = docker_svc.start_container(container_id)
        return result
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.post("/containers/{container_id}/stop")
async def stop_container(container_id: str, _user=Depends(get_current_user)):
    """Stop a container."""
    _check_docker()
    try:
        result = docker_svc.stop_container(container_id)
        return result
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/containers/{container_id}/logs")
async def container_logs(container_id: str, tail: int = 200, _user=Depends(get_current_user)):
    """Get container logs."""
    _check_docker()
    try:
        logs = docker_svc.container_logs(container_id, tail=tail)
        return {"container_id": container_id, "logs": logs}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


# ═══════════════════════════════════════════════════════════
#  Images
# ═══════════════════════════════════════════════════════════

@router.get("/images")
async def list_images(_user=Depends(get_current_user)):
    """List Docker images."""
    _check_docker()
    images = docker_svc.list_images()
    return {"images": images, "total": len(images)}
