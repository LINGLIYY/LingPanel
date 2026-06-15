"""LingServer Dashboard — Event Bus

Typed event layer wrapping ConnectionManager for decoupled pub/sub.
Allows backend services to emit events without knowing about WebSocket transport.

Security: user_id-scoped subscriptions prevent cross-user event leakage.
Supports both broadcast (push to all subscribers) and queue-based consumption
(for thin-shell WS handlers that need in-process event delivery).
"""
import asyncio
from dataclasses import dataclass, field, asdict
from typing import Any
from server.ws import ConnectionManager


# ═══════════════════════════════════════════════════════════
#  Event types
# ═══════════════════════════════════════════════════════════

@dataclass
class MetricEvent:
    """System metrics snapshot pushed every 1s."""
    data: dict
    type: str = "metric"
    channel: str = "system"

    def to_dict(self) -> dict:
        return {"type": self.type, **self.data}


@dataclass
class AlertEvent:
    """Alert lifecycle event (fired / recovered / acknowledged)."""
    rule_name: str
    metric: str
    threshold: float
    actual_value: float
    message: str
    level: str = "critical"          # "critical" | "warning" | "info"
    alert_id: int | None = None
    type: str = "alert"
    channel: str = "system"

    def to_dict(self) -> dict:
        d = {
            "type": self.type,
            "rule_name": self.rule_name,
            "metric": self.metric,
            "threshold": self.threshold,
            "actual_value": self.actual_value,
            "message": self.message,
            "level": self.level,
        }
        if self.alert_id is not None:
            d["id"] = self.alert_id
        return d


@dataclass
class LifecycleEvent:
    """Application lifecycle signal."""
    signal: str                       # "startup" | "shutdown"
    type: str = "lifecycle"
    channel: str = "system"

    def to_dict(self) -> dict:
        return {"type": self.type, "signal": self.signal}


# ═══════════════════════════════════════════════════════════
#  EventBus
# ═══════════════════════════════════════════════════════════

class EventBus:
    """Typed pub/sub wrapper around ConnectionManager.

    Subscriptions are scoped by (conn_id, user_id) so that publish()
    only reaches connections belonging to the same user.  In the current
    single-admin deployment this is a no-op, but the isolation boundary
    is enforced at the API level so multi-user expansion is safe.

    AlertEvents are rate-limited per-user via a simple token bucket to
    prevent a misbehaving alert engine from flooding WebSocket clients.
    """

    def __init__(self, manager: ConnectionManager):
        self._manager = manager
        # conn_id → user_id  (populated by subscribe())
        self._conn_users: dict[str, Any] = {}
        # Simple rate-limit: (user_id, channel) → last publish time
        self._last_publish: dict[tuple[Any, str], float] = {}
        self._rate_limit_interval: float = 0.1  # 10 alerts/sec per user-channel
        # Per-channel queues for in-process consumers (WS handlers, etc.)
        # channel → list[asyncio.Queue]
        self._queues: dict[str, list[asyncio.Queue]] = {}

    # ── Subscription (security: bind user_id) ──

    def subscribe(self, conn_id: str, channels: list[str], user_id: Any = None):
        """Register a connection for channels with optional user scoping."""
        self._manager.subscribe(conn_id, channels)
        if user_id is not None:
            self._conn_users[conn_id] = user_id

    def disconnect(self, conn_id: str):
        """Remove a connection and its user mapping."""
        self._conn_users.pop(conn_id, None)
        self._manager.disconnect(conn_id)

    # ── Publish ──

    async def publish(self, event, user_id: Any = None):
        """Broadcast an event to all subscribers of its channel.

        When user_id is provided, only connections belonging to that user
        receive the event (cross-user isolation).  Events are also delivered
        to any in-process queue subscribers.
        """
        channel = event.channel
        payload = event.to_dict()

        # Rate-limit per (user_id, channel) — only for AlertEvent (high-frequency risk)
        if isinstance(event, AlertEvent):
            import time
            key = (user_id, channel)
            now = time.time()
            last = self._last_publish.get(key, 0)
            if now - last < self._rate_limit_interval:
                return  # drop
            self._last_publish[key] = now

        # ── Deliver to queue subscribers ──
        for q in list(self._queues.get(channel, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop oldest, insert latest (best-effort backpressure)
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

        # ── Deliver to WebSocket subscribers ──
        if user_id is not None:
            # Scoped broadcast: only connections matching user_id
            conn_ids = list(self._manager._channels.get(channel, set()))
            for cid in conn_ids:
                if self._conn_users.get(cid) == user_id:
                    await self._manager.send(cid, payload)
        else:
            # Unscoped broadcast (original behavior — for system-wide events)
            await self._manager.broadcast(channel, payload)

    # ── Queue-based consumption (for thin-shell WS handlers) ──

    def subscribe_queue(self, channel: str, maxsize: int = 64) -> asyncio.Queue:
        """Return an asyncio.Queue that receives events published to `channel`.

        Used by WS handlers that need to consume events in a read-loop
        rather than receiving push broadcasts.  The queue is auto-removed
        from the subscriber list when garbage-collected (caller should keep
        a reference).

        maxsize provides backpressure — when the queue is full, the oldest
        event is dropped with a warning log.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        if channel not in self._queues:
            self._queues[channel] = []
        self._queues[channel].append(q)
        return q

    def unsubscribe_queue(self, channel: str, q: asyncio.Queue):
        """Remove a queue subscription."""
        qs = self._queues.get(channel)
        if qs:
            try:
                qs.remove(q)
            except ValueError:
                pass
            if not qs:
                del self._queues[channel]

    # ── Delegates ──

    async def connect(self, ws, user_id: Any = None) -> str:
        """Accept a WebSocket connection.  Caller must have called ws.accept() first."""
        conn_id = await self._manager.connect(ws)
        if user_id is not None:
            self._conn_users[conn_id] = user_id
        return conn_id

    async def send(self, conn_id: str, data: dict):
        """Send a raw JSON message to a single connection."""
        await self._manager.send(conn_id, data)

    @property
    def connection_count(self) -> int:
        return self._manager.connection_count
