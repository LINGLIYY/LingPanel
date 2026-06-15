---
name: docker-endpoint-consistency
description: Docker info endpoint now returns 503 + /info alias added for client compatibility
metadata:
  type: project
---

`/api/docker` originally returned 200 with `{"available": false}` when Docker was unavailable, while all other Docker endpoints returned 503 via `_check_docker()`. This was inconsistent with the project convention "Docker 不可用 → 503". Additionally, `/api/docker/info` didn't exist as a route (404).

The fix:
1. `_check_docker()` added to the `/api/docker` (info) endpoint — now returns 503 like all others
2. New `/api/docker/info` alias route added — identical behavior, for clients that expect this path

**Frontend impact:** `js/tabs/docker.js` already handles both 200-with-available-false and 503 correctly — its catch block shows the same "Docker 不可用" empty state.

**Why:** Consistent error signaling across all Docker endpoints. The `/info` alias prevents 404 confusion for users and tools that expect a RESTful `/{resource}/info` pattern.

**How to apply:** When adding new Docker endpoints, always include `_check_docker()` at the top for graceful degradation.

[[secret-key-import-timing]]
