"""LingServer Dashboard — Lifecycle Coordinator

Manages background task registration and coordinated shutdown.
Replaces ad-hoc create_task() calls with a single registry so that
startup order is explicit and shutdown cancels all tasks cleanly.
"""
import asyncio
import logging
from typing import Callable, Awaitable

_logger = logging.getLogger("ling.lifecycle")


class LifecycleCoordinator:
    """Register background tasks and shut them down in reverse order."""

    def __init__(self):
        self._tasks: list[asyncio.Task] = []
        self._cleanups: list[Callable[[], Awaitable]] = []

    def register(self, coro, cleanup: Callable[[], Awaitable] | None = None):
        """Start a background coroutine and track it for shutdown.

        If `cleanup` is provided, it is called (in reverse registration order)
        during shutdown after the task is cancelled.
        """
        task = asyncio.create_task(coro)
        self._tasks.append(task)
        if cleanup:
            self._cleanups.append(cleanup)

    async def shutdown(self):
        """Cancel all registered tasks in reverse order, then run cleanups."""
        # Cancel tasks (reverse order — dependents first)
        for task in reversed(self._tasks):
            task.cancel()
        # Wait for cancellations to propagate
        results = await asyncio.gather(*self._tasks, return_exceptions=True)
        for task, result in zip(self._tasks, results):
            if isinstance(result, Exception) and not isinstance(result, asyncio.CancelledError):
                _logger.warning(f"Task {task.get_name()} raised on shutdown: {result}")

        # Run cleanup callbacks (reverse order)
        for cleanup in reversed(self._cleanups):
            try:
                await cleanup()
            except Exception:
                _logger.warning("Cleanup failed", exc_info=True)

        self._tasks.clear()
        self._cleanups.clear()
