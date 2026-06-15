---
name: ws-double-accept-footgun
description: Critical WebSocket bug pattern — double ws.accept() silently kills connections
metadata:
  type: project
---

When adding WebSocket authentication to `/ws/live`, an `await ws.accept()` call was inserted before `verify_ws_auth()` in system.py. But `ConnectionManager.connect()` in ws.py also called `await ws.accept()` internally. This caused a double-accept → RuntimeError on every connection, silently killing the WebSocket before any metrics could be pushed. The fix was to remove `accept()` from `ConnectionManager.connect()` — the caller is now responsible for accepting before passing the WebSocket to `connect()`.

**Why:** When modifying WebSocket code, always check whether the accept is done by the caller or the connection manager. Starlette forbids double accept.

**How to apply:** Before adding any pre-connection logic (auth, config exchange) to a WebSocket endpoint that uses ConnectionManager, verify who calls accept(). The pattern is: accept → authenticate → manager.connect().
