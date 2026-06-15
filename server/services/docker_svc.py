"""LingServer Dashboard — Docker Service

Container and image operations via Docker SDK.
Graceful degradation when Docker socket is unreachable.
"""
from typing import Any
from server.config import DOCKER_SOCKET

_docker_client = None
_docker_available = None  # tri-state: None=unchecked, True, False


def _get_client():
    """Lazy-init the Docker client. Returns None if Docker is unavailable."""
    global _docker_client, _docker_available

    if _docker_available is False:
        return None

    if _docker_client is not None:
        return _docker_client

    try:
        import docker
        # Parse DOCKER_SOCKET — on Windows it might be tcp:// or npipe://
        if DOCKER_SOCKET.startswith("unix://"):
            _docker_client = docker.DockerClient(base_url=DOCKER_SOCKET)
        elif DOCKER_SOCKET.startswith("tcp://"):
            _docker_client = docker.DockerClient(base_url=DOCKER_SOCKET)
        elif DOCKER_SOCKET.startswith("npipe://"):
            _docker_client = docker.DockerClient(base_url=DOCKER_SOCKET)
        else:
            _docker_client = docker.from_env()

        # Test connection
        _docker_client.ping()
        _docker_available = True
        return _docker_client

    except Exception:
        _docker_available = False
        _docker_client = None
        return None


def is_available() -> bool:
    """Check if Docker is reachable."""
    return _get_client() is not None


# ═══════════════════════════════════════════════════════════
#  Containers
# ═══════════════════════════════════════════════════════════

def list_containers(all: bool = True) -> list[dict[str, Any]]:
    """List containers with basic stats."""
    client = _get_client()
    if not client:
        return []

    try:
        containers = client.containers.list(all=all)
    except Exception:
        return []

    result = []
    for c in containers:
        try:
            c.reload()  # refresh stats
        except Exception:
            pass

        # Extract port mappings
        ports = []
        try:
            for private, bindings in (c.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}).items():
                if bindings:
                    for b in bindings:
                        ports.append(f"{b.get('HostPort', '?')}:{private}")
                else:
                    ports.append(private)
        except Exception:
            pass

        result.append({
            "id": c.short_id,
            "name": c.name,
            "image": "".join(c.image.tags[:1]) or c.image.short_id,
            "status": c.status,
            "state": c.attrs.get("State", {}).get("Status", "unknown"),
            "created": c.attrs.get("Created", ""),
            "cpu_percent": _parse_cpu(c),
            "memory_usage": c.attrs.get("State", {}).get("memory_stats", {}).get("usage", 0),
            "memory_limit": c.attrs.get("State", {}).get("memory_stats", {}).get("limit", 0),
            "ports": ports,
        })

    return result


def start_container(container_id: str) -> dict[str, Any]:
    """Start a stopped container."""
    client = _get_client()
    if not client:
        raise RuntimeError("Docker 不可用")

    try:
        c = client.containers.get(container_id)
        c.start()
        return {"success": True, "container_id": container_id, "action": "start"}
    except Exception as e:
        raise RuntimeError(f"启动容器失败: {e}")


def stop_container(container_id: str) -> dict[str, Any]:
    """Stop a running container."""
    client = _get_client()
    if not client:
        raise RuntimeError("Docker 不可用")

    try:
        c = client.containers.get(container_id)
        c.stop()
        return {"success": True, "container_id": container_id, "action": "stop"}
    except Exception as e:
        raise RuntimeError(f"停止容器失败: {e}")


def container_logs(container_id: str, tail: int = 200) -> str:
    """Get recent logs from a container."""
    client = _get_client()
    if not client:
        raise RuntimeError("Docker 不可用")

    try:
        c = client.containers.get(container_id)
        logs = c.logs(tail=tail, timestamps=True).decode("utf-8", errors="replace")
        return logs
    except Exception as e:
        raise RuntimeError(f"获取日志失败: {e}")


# ═══════════════════════════════════════════════════════════
#  Images
# ═══════════════════════════════════════════════════════════

def list_images() -> list[dict[str, Any]]:
    """List Docker images."""
    client = _get_client()
    if not client:
        return []

    try:
        images = client.images.list()
    except Exception:
        return []

    result = []
    for img in images:
        tags = img.tags if img.tags else ["<none>:<none>"]
        for tag in tags:
            result.append({
                "id": img.short_id,
                "tag": tag,
                "size_bytes": img.attrs.get("Size", 0),
                "created": img.attrs.get("Created", ""),
            })

    return result


# ═══════════════════════════════════════════════════════════
#  Health
# ═══════════════════════════════════════════════════════════

def docker_info() -> dict[str, Any]:
    """Get Docker system info."""
    client = _get_client()
    if not client:
        return {"available": False, "error": "Docker socket 不可达"}

    try:
        info = client.info()
        return {
            "available": True,
            "containers": info.get("Containers", 0),
            "containers_running": info.get("ContainersRunning", 0),
            "images": info.get("Images", 0),
            "server_version": info.get("ServerVersion", ""),
            "os": info.get("OperatingSystem", ""),
            "driver": info.get("Driver", ""),
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════

def _parse_cpu(container) -> float:
    """Calculate CPU percentage from Docker stats."""
    try:
        stats = container.stats(stream=False)
        cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - \
                    stats["precpu_stats"]["cpu_usage"]["total_usage"]
        system_delta = stats["cpu_stats"].get("system_cpu_usage", 0) - \
                       stats["precpu_stats"].get("system_cpu_usage", 0)
        num_cpus = stats["cpu_stats"].get("online_cpus", 1)

        if system_delta > 0 and cpu_delta > 0:
            return round((cpu_delta / system_delta) * num_cpus * 100, 2)
    except Exception:
        pass
    return 0.0
