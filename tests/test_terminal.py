"""LingServer Dashboard — Terminal Tests

Covers: WebSocket session create/attach, REST session list/kill,
        encoding detection, resize, max sessions, cleanup.

PipeSession is used for deterministic testing (LING_TERM_FORCE_PIPE=true).
"""
import pytest


# ═══════════════════════════════════════════════════════════
#  Unit: encoding + session ID
# ═══════════════════════════════════════════════════════════


class TestEncoding:
    """Encoding detection unit tests."""

    def test_returns_non_empty_string(self):
        from server.routers.terminal import _detect_encoding
        enc = _detect_encoding()
        assert isinstance(enc, str)
        assert len(enc) > 0

    def test_returns_valid_codec(self):
        from server.routers.terminal import _detect_encoding
        enc = _detect_encoding()
        "test".encode(enc)
        "test".encode(enc).decode(enc)


class TestSessionId:
    """Session ID generation tests."""

    def test_increments(self):
        from server.routers.terminal import _next_session_id
        import server.routers.terminal as tmod
        tmod._session_counter = 0
        id1 = _next_session_id()
        id2 = _next_session_id()
        assert id1 == "term_1"
        assert id2 == "term_2"
        assert id1 != id2

    def test_format(self):
        from server.routers.terminal import _next_session_id
        sid = _next_session_id()
        assert sid.startswith("term_")
        assert int(sid.split("_")[1]) > 0


# ═══════════════════════════════════════════════════════════
#  Unit: PipeSession direct I/O
# ═══════════════════════════════════════════════════════════


class TestPipeSession:
    """PipeSession direct tests (no WebSocket)."""

    def test_spawn_and_echo(self):
        """PipeSession: spawn shell, send command, read output."""
        import asyncio
        import platform
        from server.routers.terminal import PipeSession, _detect_encoding

        async def _run():
            shell = "cmd.exe" if platform.system() == "Windows" else "/bin/sh"
            session = PipeSession(shell, _detect_encoding(), cwd=".")
            await session.start()

            try:
                await session.write(b"echo HELLO_TEST\r\n")
                await asyncio.sleep(0.3)

                chunks = []
                for _ in range(20):
                    chunk = await session.read(1024)
                    if chunk:
                        chunks.append(chunk)
                        if b"HELLO_TEST" in chunk:
                            break
                    else:
                        break

                output = b"".join(chunks)
                assert b"HELLO_TEST" in output, f"Expected HELLO_TEST in output, got: {output[:200]}"
            finally:
                session.close()

        asyncio.run(_run())

    def test_write_then_close(self):
        """PipeSession: write after close returns without error."""
        import asyncio
        from server.routers.terminal import PipeSession, _detect_encoding

        async def _run():
            session = PipeSession("cmd.exe", _detect_encoding(), cwd=".")
            await session.start()
            session.close()
            await session.write(b"test\r\n")

        asyncio.run(_run())

    def test_read_after_close_returns_empty(self):
        """PipeSession: read after close returns empty."""
        import asyncio
        from server.routers.terminal import PipeSession, _detect_encoding

        async def _run():
            session = PipeSession("cmd.exe", _detect_encoding(), cwd=".")
            await session.start()
            session.close()
            chunk = await session.read(1024)
            assert chunk == b""

        asyncio.run(_run())


# ═══════════════════════════════════════════════════════════
#  Unit: session factory
# ═══════════════════════════════════════════════════════════


class TestFactory:
    """Terminal session factory tests."""

    def test_force_pipe_returns_pipe_session(self, monkeypatch):
        """LING_TERM_FORCE_PIPE=true returns PipeSession."""
        monkeypatch.setenv("LING_TERM_FORCE_PIPE", "true")
        from server.routers.terminal import _create_terminal_session, PipeSession
        session, shell, encoding = _create_terminal_session()
        assert isinstance(session, PipeSession), f"Expected PipeSession, got {type(session).__name__}"
        assert len(shell) > 0
        assert len(encoding) > 0

    def test_returns_valid_encoding(self):
        from server.routers.terminal import _create_terminal_session
        _, _, encoding = _create_terminal_session()
        b"test".decode(encoding)


# ═══════════════════════════════════════════════════════════
#  WebSocket integration tests (PipeSession mode)
# ═══════════════════════════════════════════════════════════


@pytest.fixture
def pipe_terminal_client(app, monkeypatch):
    """TestClient with forced PipeSession mode (authenticated)."""
    monkeypatch.setenv("LING_TERM_FORCE_PIPE", "true")
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert r.status_code == 200, f"pipe_terminal_client auth failed: {r.status_code}"
        yield c


class TestTerminalWebSocket:
    """WebSocket terminal endpoint — new session tests."""

    def test_connect_new_session_and_ready(self, pipe_terminal_client):
        """Connect without session_id → create new session, receive ready."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            assert data["type"] == "ready"
            assert data["session_id"].startswith("term_")
            assert "shell" in data
            assert "encoding" in data
            assert "name" in data
            assert data["pty"] is False  # PipeSession
            # reattached key is only present when True (attach), absent for new sessions
            assert data.get("reattached") is not True

    def test_ready_message_has_required_fields(self, pipe_terminal_client):
        """Ready message contains all required fields."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            required = {"type", "session_id", "name", "shell", "encoding", "pty", "cols", "rows"}
            missing = required - set(data.keys())
            assert not missing, f"Missing fields: {missing}"

    def test_send_resize(self, pipe_terminal_client):
        """Send resize control message — should not error."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            _ = ws.receive_json()
            ws.send_json({"type": "resize", "cols": 80, "rows": 24})

    def test_send_signals(self, pipe_terminal_client):
        """Send signal control messages (Ctrl+C/D/Z/clear)."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            _ = ws.receive_json()
            for sig in ["int", "eof", "suspend", "clear"]:
                ws.send_json({"type": "signal", "name": sig})

    def test_max_sessions_error(self, pipe_terminal_client):
        """6th connection returns error (max=5)."""
        sockets = []
        for i in range(5):
            ws = pipe_terminal_client.websocket_connect("/ws/terminal")
            ws.__enter__()
            data = ws.receive_json()
            if data["type"] == "error":
                ws.__exit__(None, None, None)
                break
            sockets.append(ws)

        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            assert data["type"] == "error"
            assert "最大会话数" in data["message"]

        for ws in sockets:
            try:
                ws.__exit__(None, None, None)
            except Exception:
                pass

    def test_new_session_cleanup_on_disconnect(self, pipe_terminal_client):
        """New session (no attach) is cleaned up when WS disconnects."""
        from server.routers.terminal import _sessions

        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            sid = data["session_id"]
            assert sid in _sessions

        assert sid not in _sessions, "New session should be cleaned up on disconnect"

    def test_raw_input(self, pipe_terminal_client):
        """Sending raw text input should not crash."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            _ = ws.receive_json()
            ws.send_text("echo raw_test\r\n")

    def test_invalid_json_treated_as_raw(self, pipe_terminal_client):
        """Invalid JSON starting with { is sent to shell as raw text."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            _ = ws.receive_json()
            ws.send_text('{"type": "unknown_type"}')
            ws.send_text('{not valid')

    def test_empty_input(self, pipe_terminal_client):
        """Empty input should not crash."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            _ = ws.receive_json()
            ws.send_text("")

    def test_rename_control_message(self, pipe_terminal_client):
        """Send rename control message."""
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            sid = data["session_id"]
            ws.send_json({"type": "rename", "name": "My Shell"})
            # No error expected


class TestTerminalAttach:
    """WebSocket attach-to-existing-session tests."""

    def test_attach_to_existing_session(self, pipe_terminal_client):
        """Attach to existing session → get ready with reattached=True."""
        from server.routers.terminal import _sessions

        # First: create a session
        with pipe_terminal_client.websocket_connect("/ws/terminal") as ws1:
            data1 = ws1.receive_json()
            sid = data1["session_id"]
            assert sid in _sessions

            # Second: attach to same session (this replaces ws1)
            with pipe_terminal_client.websocket_connect(
                f"/ws/terminal?session_id={sid}"
            ) as ws2:
                data2 = ws2.receive_json()
                assert data2["type"] == "ready"
                assert data2["session_id"] == sid
                assert data2["reattached"] is True

        # After both disconnect, session should still be cleaned up
        # (original ws was closed + replaced, attached ws is NOT is_attach False... wait)
        # Actually is_attach=True for ws2, so on ws2 close session is NOT cleaned up.
        # But ws1 was closed by ws2, so ws1's cleanup also skipped.
        # The session remains! Let's clean it up manually.
        from server.routers.terminal import _cleanup_session
        import asyncio
        async def _clean():
            if sid in _sessions:
                await _cleanup_session(sid)
        asyncio.run(_clean())

    def test_attach_to_nonexistent_creates_new(self, pipe_terminal_client):
        """Attach to nonexistent session_id → creates new session."""
        with pipe_terminal_client.websocket_connect(
            "/ws/terminal?session_id=nonexistent_12345"
        ) as ws:
            data = ws.receive_json()
            # Should create a new session (not error)
            assert data["type"] == "ready"
            assert data["session_id"] != "nonexistent_12345"


# ═══════════════════════════════════════════════════════════
#  REST endpoint tests (requires auth)
# ═══════════════════════════════════════════════════════════


class TestSessionRestApi:
    """GET/DELETE /api/terminal/sessions tests."""

    def test_list_sessions_empty(self, auth_client):
        """List sessions when none exist."""
        r = auth_client.get("/api/terminal/sessions")
        assert r.status_code == 200
        data = r.json()
        assert "sessions" in data
        assert "max" in data
        assert data["max"] == 5

    def test_list_sessions_requires_auth(self, client):
        """Session list requires authentication."""
        r = client.get("/api/terminal/sessions")
        assert r.status_code in (401, 403)

    def test_kill_nonexistent_session(self, auth_client):
        """Kill a nonexistent session returns 404."""
        r = auth_client.delete("/api/terminal/sessions/nonexistent_999")
        assert r.status_code == 404

    def test_full_lifecycle(self, auth_client, monkeypatch):
        """Create session via WS, list it, kill it via REST."""
        monkeypatch.setenv("LING_TERM_FORCE_PIPE", "true")

        # Create session via WebSocket
        with auth_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()
            sid = data["session_id"]

            # List sessions — should contain our session
            r = auth_client.get("/api/terminal/sessions")
            assert r.status_code == 200
            sessions = r.json()["sessions"]
            sids = [s["session_id"] for s in sessions]
            assert sid in sids, f"Session {sid} not found in list: {sids}"

            # Kill the session
            r = auth_client.delete(f"/api/terminal/sessions/{sid}")
            assert r.status_code == 200
            assert r.json()["status"] == "ok"

            # List again — session should be gone
            r = auth_client.get("/api/terminal/sessions")
            sessions = r.json()["sessions"]
            sids = [s["session_id"] for s in sessions]
            assert sid not in sids, f"Session {sid} should be killed"

    def test_list_session_has_required_fields(self, auth_client, monkeypatch):
        """Each session in list has required fields."""
        monkeypatch.setenv("LING_TERM_FORCE_PIPE", "true")

        with auth_client.websocket_connect("/ws/terminal") as ws:
            data = ws.receive_json()

        r = auth_client.get("/api/terminal/sessions")
        sessions = r.json()["sessions"]
        if sessions:
            s = sessions[0]
            required = {"session_id", "name", "shell", "encoding", "cwd",
                        "created_at", "idle_seconds", "has_pty", "pid"}
            missing = required - set(s.keys())
            assert not missing, f"Missing fields: {missing}"


# ═══════════════════════════════════════════════════════════
#  Session management (direct API)
# ═══════════════════════════════════════════════════════════


class TestSessionManagement:
    """Session lifecycle tests via internal API."""

    def test_create_and_cleanup(self, monkeypatch):
        """Create session via internal API, verify cleanup."""
        monkeypatch.setenv("LING_TERM_FORCE_PIPE", "true")
        import asyncio
        from server.routers.terminal import _sessions, _create_session, _cleanup_session

        async def _run():
            from unittest.mock import AsyncMock, MagicMock
            ws = MagicMock()
            ws.send_json = AsyncMock()

            sid = await _create_session(ws, name="test-shell")
            assert sid is not None
            assert sid in _sessions
            assert _sessions[sid]["name"] == "test-shell"
            assert _sessions[sid]["encoding"] is not None
            assert _sessions[sid]["is_pipe"] is True

            await _cleanup_session(sid)
            assert sid not in _sessions

        asyncio.run(_run())


# ═══════════════════════════════════════════════════════════
#  Audit tests
# ═══════════════════════════════════════════════════════════


class TestAuditDangerDetection:
    """Dangerous command detection unit tests."""

    def test_detect_rm_rf_root(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("rm -rf /")
        assert len(matches) > 0
        assert any("rm" in m["description"].lower() for m in matches)

    def test_detect_drop_table(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("DROP TABLE users;")
        assert len(matches) > 0

    def test_detect_shutdown(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("shutdown -h now")
        assert len(matches) > 0

    def test_safe_command_no_match(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("ls -la /tmp")
        assert len(matches) == 0

    def test_safe_command_echo(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("echo hello world")
        assert len(matches) == 0

    def test_empty_input(self):
        from server.services.terminal_audit import check_dangerous
        assert check_dangerous("") == []
        assert check_dangerous("  ") == []

    def test_detect_chmod_777(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("chmod 777 /etc/passwd")
        assert len(matches) > 0

    def test_detect_iptables_flush(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("iptables -F")
        assert len(matches) > 0

    def test_dangerous_severity_levels(self):
        from server.services.terminal_audit import check_dangerous
        matches = check_dangerous("rm -rf /")
        for m in matches:
            assert m["severity"] in ("critical", "high", "medium")
            assert "description" in m
            assert "pattern" in m


class TestAuditLogging:
    """Audit database logging tests."""

    def test_log_command_writes_to_db(self, db):
        """Log a command and verify it appears in the audit table."""
        from server.services.terminal_audit import log_command

        dangerous = log_command(db, "test_session_1", "ls -la /home", username="admin", cwd="/home")
        assert dangerous == []  # safe command

        row = db.execute(
            "SELECT * FROM terminal_audit WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            ("test_session_1",),
        ).fetchone()
        assert row is not None
        assert row["input_text"] == "ls -la /home"
        assert row["is_dangerous"] == 0
        assert row["username"] == "admin"

    def test_log_dangerous_command(self, db):
        """Log a dangerous command and verify danger flag + return value."""
        from server.services.terminal_audit import log_command

        dangerous = log_command(db, "test_danger", "rm -rf /etc/nginx", username="admin", cwd="/")
        assert len(dangerous) > 0  # should return danger matches

        row = db.execute(
            "SELECT * FROM terminal_audit WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            ("test_danger",),
        ).fetchone()
        assert row is not None
        assert row["is_dangerous"] == 1

    def test_query_audit_returns_paginated(self, db):
        """Query audit log returns correct structure."""
        from server.services.terminal_audit import log_command, query_audit

        # Log a few commands
        for i in range(3):
            log_command(db, f"session_{i}", f"command_{i}", username="test")

        result = query_audit(db, limit=2, offset=0)
        assert result["total"] >= 3
        assert result["limit"] == 2
        assert len(result["items"]) == 2

    def test_query_audit_dangerous_only(self, db):
        """Filter audit log to dangerous commands only."""
        from server.services.terminal_audit import log_command, query_audit

        log_command(db, "s1", "ls", username="test")
        log_command(db, "s1", "rm -rf /tmp/test", username="test")
        log_command(db, "s1", "echo ok", username="test")

        result = query_audit(db, session_id="s1", dangerous_only=True)
        for item in result["items"]:
            assert item["is_dangerous"] == 1

    def test_query_audit_by_session(self, db):
        """Filter audit log by session ID."""
        from server.services.terminal_audit import log_command, query_audit

        log_command(db, "session_A", "cmd_a", username="test")
        log_command(db, "session_B", "cmd_b", username="test")

        result = query_audit(db, session_id="session_A")
        for item in result["items"]:
            assert item["session_id"] == "session_A"


class TestAuditApi:
    """Audit REST endpoint tests."""

    def test_audit_endpoint_requires_auth(self, client):
        """Audit API requires authentication."""
        r = client.get("/api/terminal/audit")
        assert r.status_code in (401, 403)

    def test_audit_endpoint_returns_structure(self, auth_client):
        """Audit API returns correct JSON structure."""
        r = auth_client.get("/api/terminal/audit")
        assert r.status_code == 200
        data = r.json()
        assert "total" in data
        assert "items" in data
        assert "limit" in data
        assert "offset" in data

    def test_audit_endpoint_with_params(self, auth_client):
        """Audit API accepts query parameters."""
        r = auth_client.get("/api/terminal/audit?limit=10&offset=0&dangerous_only=true")
        assert r.status_code == 200
        data = r.json()
        assert data["limit"] == 10
