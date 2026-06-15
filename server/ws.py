"""LingServer Dashboard — WebSocket Manager

Connection pool with channel-based pub/sub and heartbeat.
Single-instance, in-memory — no Redis needed for one admin.
"""
import asyncio
import json
import time
from typing import Any
from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections with channel subscription."""

    def __init__(self):
        # conn_id → WebSocket
        self._connections: dict[str, WebSocket] = {}
        # conn_id → set of channel names
        self._subscriptions: dict[str, set[str]] = {}
        # channel → set of conn_ids
        self._channels: dict[str, set[str]] = {}
        self._counter = 0

    def _next_id(self) -> str:
        self._counter += 1
        return f"conn_{self._counter}"

    # ── Connection lifecycle ──

    async def connect(self, ws: WebSocket) -> str:
        # Caller is responsible for ws.accept() before calling connect()
        conn_id = self._next_id()
        self._connections[conn_id] = ws
        self._subscriptions[conn_id] = set()
        return conn_id

    def disconnect(self, conn_id: str):
        # Remove from channels
        subs = self._subscriptions.pop(conn_id, set())
        for channel in subs:
            ch = self._channels.get(channel)
            if ch:
                ch.discard(conn_id)
                if not ch:
                    del self._channels[channel]
        self._connections.pop(conn_id, None)

    # ── Subscription ──

    def subscribe(self, conn_id: str, channels: list[str]):
        subs = self._subscriptions.get(conn_id)
        if subs is None:
            return
        for channel in channels:
            subs.add(channel)
            if channel not in self._channels:
                self._channels[channel] = set()
            self._channels[channel].add(conn_id)

    def unsubscribe(self, conn_id: str, channels: list[str]):
        subs = self._subscriptions.get(conn_id)
        if subs is None:
            return
        for channel in channels:
            subs.discard(channel)
            ch = self._channels.get(channel)
            if ch:
                ch.discard(conn_id)
                if not ch:
                    del self._channels[channel]

    # ── Broadcast ──

    async def broadcast(self, channel: str, data: dict[str, Any]):
        """Send a JSON message to all subscribers of a channel."""
        conn_ids = list(self._channels.get(channel, set()))
        payload = json.dumps(data)

        dead = []
        for cid in conn_ids:
            ws = self._connections.get(cid)
            if ws is None:
                dead.append(cid)
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(cid)

        for cid in dead:
            self.disconnect(cid)

    async def send(self, conn_id: str, data: dict[str, Any]):
        """Send a JSON message to a specific connection."""
        ws = self._connections.get(conn_id)
        if ws:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                self.disconnect(conn_id)

    # ── Heartbeat ──

    async def heartbeat_loop(self, interval: float = 30.0):
        """Periodically ping all connections. Run as background task."""
        while True:
            await asyncio.sleep(interval)
            dead = []
            for cid, ws in list(self._connections.items()):
                try:
                    await ws.send_json({"type": "ping", "ts": int(time.time())})
                except Exception:
                    dead.append(cid)
            for cid in dead:
                self.disconnect(cid)

    @property
    def connection_count(self) -> int:
        return len(self._connections)


# Singleton
manager = ConnectionManager()
