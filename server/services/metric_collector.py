"""LingServer Dashboard — Metric Collector

Background service: collects psutil system metrics every 1s and publishes
MetricEvents via EventBus.  Replaces the inline polling loop previously
embedded in the /ws/live WebSocket handler.

Reuses the existing _collect_system() from server.routers.system for data
consistency between REST (/api/system) and WebSocket (/ws/live).

Security: _collect_system() returns only aggregate CPU / memory / disk /
network data — no cmdline, environ, or per-process details.
"""
import asyncio
import logging

from server.routers.system import _collect_system
from server.events import MetricEvent

_logger = logging.getLogger("ling.collector")


class MetricCollector:
    """Collects system metrics on an interval and publishes via EventBus."""

    def __init__(self, event_bus, interval: float = 1.0):
        self._event_bus = event_bus
        self._interval = interval

    async def run(self):
        """Background task: collect → publish → sleep."""
        while True:
            try:
                data = _collect_system()
                # Cache for alert_engine reuse (avoids duplicate psutil calls)
                self._event_bus.latest_metrics = data
                await self._event_bus.publish(MetricEvent(data=data))
            except Exception:
                _logger.warning("Metric collection failed", exc_info=True)
            await asyncio.sleep(self._interval)
