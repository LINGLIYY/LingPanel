"""LingServer Dashboard — In-Memory Rate Limiter

Sliding-window rate limiter as a pure ASGI middleware.
No Redis dependency — single admin, single instance.
"""
import time
from collections import defaultdict
from starlette.responses import Response


class RateLimiter:
    """Sliding-window rate limiter.

    Usage:
        limiter = RateLimiter(default="60/minute", routes={"/api/auth/login": "5/minute"})
        app.add_middleware(RateLimitMiddleware, limiter=limiter)
    """

    def __init__(self, default: str = "60/minute", routes: dict[str, str] | None = None):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._default = self._parse(default)
        self._routes = {path: self._parse(limit) for path, limit in (routes or {}).items()}

    @staticmethod
    def _parse(spec: str) -> tuple[int, float]:
        """Parse '60/minute' → (60, 60.0)."""
        count, period = spec.split("/")
        count = int(count)
        seconds = {"second": 1, "minute": 60, "hour": 3600}[period]
        return count, float(seconds)

    def _resolve_limit(self, path: str) -> tuple[int, float]:
        # Exact match first
        if path in self._routes:
            return self._routes[path]
        # Prefix match
        for prefix, limit in self._routes.items():
            if path.startswith(prefix):
                return limit
        return self._default

    def check(self, client_ip: str, path: str) -> bool:
        """Return True if request is allowed, False if rate-limited."""
        max_req, window_sec = self._resolve_limit(path)
        key = f"{client_ip}:{path}"  # per-IP per-route
        now = time.time()

        # Clean expired entries
        window = self._windows[key]
        cutoff = now - window_sec
        self._windows[key] = [t for t in window if t > cutoff]

        if len(self._windows[key]) >= max_req:
            return False

        self._windows[key].append(now)
        return True

    def remaining(self, client_ip: str, path: str) -> int:
        """How many requests remain in this window."""
        max_req, window_sec = self._resolve_limit(path)
        key = f"{client_ip}:{path}"
        cutoff = time.time() - window_sec
        used = sum(1 for t in self._windows.get(key, []) if t > cutoff)
        return max(0, max_req - used)

    def cleanup_expired(self) -> int:
        """Remove keys whose last request is older than the max window (1 hour).
        Call periodically to prevent unbounded memory growth.
        Returns number of keys removed.
        """
        now = time.time()
        cutoff = now - 3600  # 1 hour — longer than any rate window
        stale = [k for k, ts_list in list(self._windows.items())
                 if not ts_list or (ts_list and ts_list[-1] < cutoff)]
        for k in stale:
            del self._windows[k]
        return len(stale)


class RateLimitMiddleware:
    """ASGI middleware that applies rate limiting."""

    def __init__(self, app, limiter: RateLimiter):
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Read from scope directly — do NOT consume receive
        client_ip = scope.get("client", ("unknown", 0))[0]
        path = scope.get("path", "/")

        if not self.limiter.check(client_ip, path):
            response = Response(
                content='{"detail":"请求过于频繁，请稍后再试"}',
                status_code=429,
                media_type="application/json",
            )
            response.headers["Retry-After"] = "60"
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
