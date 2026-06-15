"""LingServer Dashboard — Terminal WebSocket

WS /ws/terminal — bidirectional shell with PTY.
Architecture: TerminalSession (abstract) → ConPtySession | UnixPtySession | PipeSession.
Supports: multi-session (max 5), resize, idle timeout (30min), encoding auto-detect.
"""
from __future__ import annotations

import asyncio
import json
import locale
import logging
import os
import sys
import time
from abc import ABC, abstractmethod
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from server.config import TERMINAL_MAX_SESSIONS, TERMINAL_IDLE_TIMEOUT_MINUTES

_log = logging.getLogger("ling.terminal")

router = APIRouter(tags=["terminal"])
rest_router = APIRouter(tags=["terminal"])  # REST endpoints (auth-protected)

# ═══════════════════════════════════════════════════════════
#  Encoding detection
# ═══════════════════════════════════════════════════════════


def _detect_encoding() -> str:
    """Detect system encoding for shell I/O.

    Chinese Windows → cp936, Japanese → cp932, Korean → cp949,
    English Windows → cp1252, Unix → utf-8.
    """
    try:
        enc = locale.getpreferredencoding()
        return enc if enc else "utf-8"
    except Exception:
        return "utf-8"


# ═══════════════════════════════════════════════════════════
#  Terminal Session — Abstract
# ═══════════════════════════════════════════════════════════


class TerminalSession(ABC):
    """Abstract terminal session backed by PTY or pipes."""

    closed: bool = False

    @abstractmethod
    async def read(self, n: int = 4096) -> bytes: ...

    @abstractmethod
    async def write(self, data: bytes) -> None: ...

    @abstractmethod
    def resize(self, cols: int, rows: int) -> None: ...

    @abstractmethod
    def close(self) -> None: ...

    @property
    @abstractmethod
    def pid(self) -> int: ...


# ═══════════════════════════════════════════════════════════
#  ConPTY Session  (Windows 10 1809+)
# ═══════════════════════════════════════════════════════════


class ConPtySession(TerminalSession):
    """Windows pseudo-console via pywinpty.

    Single-threaded I/O using select() + socket-pair wakeup.
    All PTY reads/writes happen on one dedicated thread;
    communication with the event loop via asyncio.Queue.
    """

    def __init__(self, shell_cmd: str, cols: int = 120, rows: int = 40, cwd: str = "."):
        import queue as _qmod
        import select as _sel
        import socket as _sock
        import threading as _threading
        from winpty import PtyProcess

        self._pty = PtyProcess.spawn(
            shell_cmd,
            dimensions=(rows, cols),
            cwd=cwd if os.path.isdir(cwd) else ".",
            env=self._build_env(),
        )
        self.closed = False
        self._read_queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._write_queue: _qmod.Queue = _qmod.Queue()
        self._loop = asyncio.get_event_loop()

        # Socket pair for wakeup (Windows select only supports sockets)
        self._wake_r, self._wake_w = _sock.socketpair()
        self._wake_r.setblocking(False)
        self._pty_fd = self._pty.fileno()

        self._io_thread = _threading.Thread(target=self._io_loop, daemon=True)
        self._io_thread.start()

    @staticmethod
    def _build_env() -> dict:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["PYTHONIOENCODING"] = "utf-8"
        env["COLORTERM"] = "truecolor"
        return env

    def _wake_io_thread(self) -> None:
        """Send a byte through the wake socket to interrupt select()."""
        try:
            self._wake_w.send(b"\x00")
        except Exception:
            pass

    def _io_loop(self) -> None:
        """Single thread: select on [PTY fd, wake socket], process I/O."""
        import select as _sel
        try:
            while not self.closed:
                # select() blocks until PTY has data OR wake signal
                try:
                    r, _, _ = _sel.select([self._pty_fd, self._wake_r], [], [], 1.0)
                except Exception:
                    break

                for fd in r:
                    if fd == self._wake_r:
                        # Drain wake socket
                        try:
                            self._wake_r.recv(4096)
                        except Exception:
                            pass
                        # Process all queued writes
                        while True:
                            try:
                                data = self._write_queue.get_nowait()
                                self._pty.write(data)
                            except Exception:
                                break

                    elif fd == self._pty_fd:
                        # Read PTY output
                        try:
                            data = self._pty.read(4096)
                        except EOFError:
                            self.closed = True
                            return
                        if data is None:
                            self.closed = True
                            return
                        if isinstance(data, str) and len(data) > 0:
                            self._loop.call_soon_threadsafe(
                                self._read_queue.put_nowait,
                                data.encode("utf-8", errors="replace"),
                            )
                        elif isinstance(data, bytes) and len(data) > 0:
                            self._loop.call_soon_threadsafe(
                                self._read_queue.put_nowait,
                                data,
                            )

        except Exception:
            pass
        finally:
            try:
                self._loop.call_soon_threadsafe(self._read_queue.put_nowait, b"")
            except Exception:
                pass

    async def read(self, n: int = 4096) -> bytes:
        try:
            return await self._read_queue.get()
        except RuntimeError:
            return b""

    async def write(self, data: bytes) -> None:
        """Queue data for the IO thread and wake it up."""
        # pywinpty PtyProcess.write() expects str
        text = data.decode("utf-8", errors="replace")
        self._write_queue.put(text)
        self._wake_io_thread()

    def resize(self, cols: int, rows: int) -> None:
        try:
            self._pty.setwinsize(rows, cols)
        except Exception:
            pass

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        # Wake the IO thread so it can exit
        self._wake_io_thread()
        try:
            self._pty.terminate()
        except Exception:
            pass
        try:
            self._wake_r.close()
            self._wake_w.close()
        except Exception:
            pass

    @property
    def pid(self) -> int:
        return self._pty.pid

    @property
    def isalive(self) -> bool:
        try:
            return self._pty.isalive()
        except Exception:
            return False


# ═══════════════════════════════════════════════════════════
#  Unix PTY Session
# ═══════════════════════════════════════════════════════════


class UnixPtySession(TerminalSession):
    """Unix PTY via pty + termios."""

    def __init__(self, shell_cmd: str, cols: int = 120, rows: int = 40, cwd: str = "/"):
        import fcntl
        import pty
        import struct
        import termios
        import tty

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["LANG"] = "en_US.UTF-8"
        env["LC_ALL"] = "en_US.UTF-8"
        env["PYTHONIOENCODING"] = "utf-8"
        env["COLORTERM"] = "truecolor"

        self._master_fd, slave_fd = pty.openpty()
        tty.setraw(self._master_fd)

        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

        # asyncio.create_subprocess_shell accepts file descriptors for stdin/stdout/stderr
        # We pass the slave fd so the child process's I/O goes through the PTY
        self._proc_future = asyncio.ensure_future(
            asyncio.create_subprocess_shell(
                shell_cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=cwd,
                env=env,
                preexec_fn=os.setsid,
            )
        )
        os.close(slave_fd)  # Child inherits it; we keep master_fd
        self.closed = False
        self._cols = cols
        self._rows = rows

    async def _ensure_proc(self):
        """Resolve the process future lazily."""
        if not hasattr(self, '_proc'):
            self._proc = await self._proc_future

    @property
    def _proc_ready(self) -> bool:
        return hasattr(self, '_proc')

    async def read(self, n: int = 4096) -> bytes:
        loop = asyncio.get_event_loop()

        def _read_blocking():
            return os.read(self._master_fd, n)

        try:
            return await loop.run_in_executor(None, _read_blocking)
        except OSError:
            return b""

    async def write(self, data: bytes) -> None:
        loop = asyncio.get_event_loop()

        def _write_blocking():
            os.write(self._master_fd, data)

        await loop.run_in_executor(None, _write_blocking)

    def resize(self, cols: int, rows: int) -> None:
        import fcntl
        import struct
        import termios
        import signal

        self._cols = cols
        self._rows = rows
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass
        try:
            if self._proc_ready:
                os.kill(self._proc.pid, signal.SIGWINCH)
        except Exception:
            pass

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            os.close(self._master_fd)
        except Exception:
            pass
        try:
            if self._proc_ready:
                self._proc.terminate()
        except Exception:
            pass

    @property
    def pid(self) -> int:
        return self._proc.pid if self._proc_ready else -1


# ═══════════════════════════════════════════════════════════
#  Pipe Session  (fallback — no PTY)
# ═══════════════════════════════════════════════════════════


class PipeSession(TerminalSession):
    """Fallback: plain subprocess pipes. No resize, no advanced TTY features."""

    def __init__(self, shell_cmd: str, encoding: str, cwd: str = "/"):
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._shell_cmd = shell_cmd
        self._encoding = encoding
        self._cwd = cwd
        self.closed = False

    async def start(self) -> None:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["PYTHONIOENCODING"] = "utf-8"
        if os.name != "nt":
            env["LANG"] = "en_US.UTF-8"
            env["LC_ALL"] = "en_US.UTF-8"

        cwd = self._cwd if os.path.exists(self._cwd) else "/"
        self._proc = await asyncio.create_subprocess_shell(
            self._shell_cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
        )

    async def read(self, n: int = 4096) -> bytes:
        if not self._proc:
            return b""
        try:
            chunk = await self._proc.stdout.read(n)
            return chunk or b""
        except Exception:
            return b""

    async def read_stderr(self, n: int = 4096) -> bytes:
        if not self._proc:
            return b""
        try:
            chunk = await self._proc.stderr.read(n)
            return chunk or b""
        except Exception:
            return b""

    async def write(self, data: bytes) -> None:
        if self._proc and self._proc.stdin and not self._proc.stdin.is_closing():
            self._proc.stdin.write(data)
            await self._proc.stdin.drain()

    def resize(self, cols: int, rows: int) -> None:
        pass  # Not supported with plain pipes

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self._proc:
            try:
                self._proc.terminate()
            except Exception:
                pass

    @property
    def pid(self) -> int:
        return self._proc.pid if self._proc else -1


# ═══════════════════════════════════════════════════════════
#  Factory — pick the best available backend
# ═══════════════════════════════════════════════════════════


def _create_terminal_session(
    cols: int = 120,
    rows: int = 40,
    cwd: str = "/",
) -> tuple[TerminalSession, str, str]:
    """Create the best available terminal session.

    Set LING_TERM_FORCE_PIPE=true to skip PTY and use pipes (for testing).
    Returns: (session, shell_name, encoding)
    """
    encoding = _detect_encoding()
    force_pipe = os.getenv("LING_TERM_FORCE_PIPE", "").lower() == "true"

    # ── Windows: try ConPTY first ──
    if os.name == "nt":
        shell = os.environ.get("COMSPEC", "cmd.exe")
        if not force_pipe:
            try:
                session = ConPtySession(shell, cols=cols, rows=rows, cwd=cwd)
                return session, shell, "utf-8"
            except Exception:
                pass

        # Fallback to pipes
        session = PipeSession(shell, encoding, cwd=cwd)
        return session, shell, encoding

    # ── Unix: try PTY first ──
    shell = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"
    if not force_pipe:
        try:
            session = UnixPtySession(shell, cols=cols, rows=rows, cwd=cwd)
            return session, shell, "utf-8"
        except Exception:
            pass

    # Fallback to pipes
    session = PipeSession(shell, encoding, cwd=cwd)
    return session, shell, encoding


# ═══════════════════════════════════════════════════════════
#  Session state
# ═══════════════════════════════════════════════════════════

_sessions: dict[str, dict] = {}
_session_counter = 0


def _next_session_id() -> str:
    global _session_counter
    _session_counter += 1
    return f"term_{_session_counter}"


# ═══════════════════════════════════════════════════════════
#  Session lifecycle
# ═══════════════════════════════════════════════════════════


async def _create_session(ws: WebSocket, cwd: str = "/", name: str = "") -> Optional[str]:
    """Create a new terminal session, send ready/error message to client."""
    if len(_sessions) >= TERMINAL_MAX_SESSIONS:
        await ws.send_json({
            "type": "error",
            "message": f"已达最大会话数 ({TERMINAL_MAX_SESSIONS})",
        })
        return None

    session_id = _next_session_id()
    session_obj, shell_cmd, encoding = _create_terminal_session(cwd=cwd)

    # PipeSession needs async start
    if isinstance(session_obj, PipeSession):
        try:
            await session_obj.start()
        except Exception as e:
            await ws.send_json({
                "type": "error",
                "message": f"无法启动 shell: {e}",
            })
            return None

    display_name = name.strip() if name and name.strip() else session_id

    _sessions[session_id] = {
        "session": session_obj,
        "ws": ws,
        "name": display_name,
        "last_activity": time.time(),
        "cwd": cwd,
        "created_at": time.time(),
        "encoding": encoding,
        "shell": shell_cmd,
        "is_pipe": isinstance(session_obj, PipeSession),
        "input_buffer": "",
    }

    # Start reader tasks
    asyncio.create_task(_read_output(session_id))
    if isinstance(session_obj, PipeSession):
        asyncio.create_task(_read_stderr_pipe(session_id))

    await ws.send_json({
        "type": "ready",
        "session_id": session_id,
        "name": display_name,
        "shell": shell_cmd,
        "encoding": encoding,
        "pty": not isinstance(session_obj, PipeSession),
        "cols": 120,
        "rows": 40,
    })
    return session_id


async def _read_output(session_id: str):
    """Read from PTY/pipe stdout and forward to WebSocket."""
    session = _sessions.get(session_id)
    if not session:
        return

    s: TerminalSession = session["session"]
    ws: WebSocket = session["ws"]
    encoding = session["encoding"]

    try:
        while not s.closed:
            chunk = await s.read(4096)
            if not chunk:
                break
            session["last_activity"] = time.time()
            try:
                text = chunk.decode(encoding, errors="replace")
                await ws.send_text(text)
            except Exception:
                break
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _read_stderr_pipe(session_id: str):
    """PipeSession only: read stderr separately."""
    session = _sessions.get(session_id)
    if not session or not session.get("is_pipe"):
        return

    s: PipeSession = session["session"]
    ws: WebSocket = session["ws"]
    encoding = session["encoding"]

    try:
        while not s.closed:
            chunk = await s.read_stderr(4096)
            if not chunk:
                break
            session["last_activity"] = time.time()
            try:
                text = chunk.decode(encoding, errors="replace")
                await ws.send_text(text)
            except Exception:
                break
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _cleanup_session(session_id: str):
    """Close PTY/process and remove session."""
    entry = _sessions.pop(session_id, None)
    if not entry:
        return

    s: TerminalSession = entry["session"]
    s.close()

    if isinstance(s, PipeSession) and s._proc:
        try:
            s._proc.terminate()
            try:
                await asyncio.wait_for(s._proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                s._proc.kill()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════
#  Idle timeout checker
# ═══════════════════════════════════════════════════════════


async def idle_checker():
    """Background task: kill sessions idle > TERMINAL_IDLE_TIMEOUT_MINUTES."""
    timeout_sec = TERMINAL_IDLE_TIMEOUT_MINUTES * 60
    _log = logging.getLogger("ling.background")
    while True:
        await asyncio.sleep(60)
        try:
            now = time.time()
            dead = []
            for sid, s in list(_sessions.items()):
                if now - s["last_activity"] > timeout_sec:
                    dead.append(sid)
            for sid in dead:
                try:
                    ws = _sessions[sid]["ws"]
                    await ws.send_json({
                        "type": "timeout",
                        "message": "会话超时已断开",
                    })
                except Exception:
                    _log.debug("Failed to send timeout message to session %s", sid)
                await _cleanup_session(sid)
        except Exception:
            _log.warning("Terminal idle checker failed", exc_info=True)


# ═══════════════════════════════════════════════════════════
#  WebSocket endpoint
# ═══════════════════════════════════════════════════════════


@router.websocket("/ws/terminal")
async def ws_terminal(
    ws: WebSocket,
    session_id: str = Query("", description="Attach to existing session ID, or empty for new"),
):
    """Terminal WebSocket — create new or attach to existing session.

    Authenticated via HttpOnly cookie (access_token) sent automatically
    by the browser on same-origin WebSocket connections.
    Attacker-controlled origins will not have the cookie.

    Query params:
        session_id: If provided, attach to an existing session (replaces old WS).
                    If omitted or empty, create a new session.
    """
    await ws.accept()
    sid: Optional[str] = None
    is_attach = False

    # ── Authenticate: read access_token from cookie or header ──
    try:
        from server.auth import verify_ws_auth
        verify_ws_auth(ws)
    except Exception:
        await ws.close(code=4001, reason="Unauthorized: 认证失败")
        return

    try:
        # ── Attach to existing session ──
        if session_id and session_id in _sessions:
            old_entry = _sessions[session_id]
            # Close the previous WebSocket gracefully
            try:
                await old_entry["ws"].close()
            except Exception:
                pass
            # Replace with new WebSocket
            old_entry["ws"] = ws
            old_entry["last_activity"] = time.time()
            sid = session_id
            is_attach = True

            await ws.send_json({
                "type": "ready",
                "session_id": sid,
                "name": old_entry.get("name", sid),
                "shell": old_entry.get("shell", ""),
                "encoding": old_entry.get("encoding", "utf-8"),
                "pty": not old_entry.get("is_pipe", True),
                "cols": 120,
                "rows": 40,
                "reattached": True,
            })

        # ── Create new session ──
        else:
            # Read first message for optional name
            name = ""
            sid = await _create_session(ws, name=name)
            if not sid:
                return

        # ── Main I/O loop ──
        while True:
            msg = await ws.receive_text()

            entry = _sessions.get(sid)
            if not entry:
                break

            entry["last_activity"] = time.time()

            # ── JSON control messages ──
            if msg.startswith("{"):
                try:
                    data = json.loads(msg)
                    msg_type = data.get("type", "")

                    if msg_type == "resize":
                        cols = data.get("cols", 120)
                        rows = data.get("rows", 40)
                        s: TerminalSession = entry["session"]
                        s.resize(int(cols), int(rows))

                    elif msg_type == "cwd":
                        entry["cwd"] = data.get("path", "/")

                    elif msg_type == "signal":
                        sig_name = data.get("name", "")
                        s = entry["session"]
                        sig_map = {"int": b"\x03", "eof": b"\x04", "suspend": b"\x1a", "clear": b"\x0c"}
                        if sig_name in sig_map:
                            await s.write(sig_map[sig_name])

                    elif msg_type == "rename":
                        new_name = data.get("name", "").strip()
                        if new_name:
                            entry["name"] = new_name

                    continue
                except json.JSONDecodeError:
                    pass

            # ── Raw terminal input ──
            s: TerminalSession = entry["session"]
            encoding = entry["encoding"]
            await s.write(msg.encode(encoding, errors="replace"))

            # ── Audit: buffer input, log complete commands ──
            buf = entry.get("input_buffer", "")
            buf += msg
            # Check for Enter (command complete)
            if "\r" in buf or "\n" in buf:
                # Extract the command (everything before the first \r or \n)
                lines = buf.replace("\r\n", "\n").replace("\r", "\n").split("\n")
                # Log each non-empty line
                for line in lines:
                    line = line.strip()
                    if line and len(line) > 1:  # Skip single-char (just Enter)
                        _audit_command(sid, line, entry.get("cwd", "/"))
                entry["input_buffer"] = ""
            else:
                entry["input_buffer"] = buf

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # Only cleanup on disconnect if NOT an attach (attach keeps session alive)
        if sid and not is_attach:
            await _cleanup_session(sid)


# ═══════════════════════════════════════════════════════════
#  Audit helpers
# ═══════════════════════════════════════════════════════════


def _audit_command(session_id: str, command: str, cwd: str = "/") -> None:
    """Log a terminal command and check for dangerous patterns."""
    try:
        from server.services.terminal_audit import log_command
        from server.models.database import get_db

        db = get_db()
        dangerous = log_command(db, session_id, command, username="admin", cwd=cwd)

        # If dangerous, send warning back to the session's WebSocket
        if dangerous:
            entry = _sessions.get(session_id)
            if entry:
                ws = entry["ws"]
                import asyncio as _aio

                async def _warn():
                    try:
                        await ws.send_json({
                            "type": "danger_warning",
                            "command": command[:200],
                            "matches": dangerous,
                        })
                    except Exception:
                        pass

                _aio.create_task(_warn())
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════
#  REST: Session management  (auth-protected in main.py)
# ═══════════════════════════════════════════════════════════


@rest_router.get("/api/terminal/sessions")
async def list_sessions():
    """List all active terminal sessions."""
    now = time.time()
    result = []
    for sid, entry in _sessions.items():
        result.append({
            "session_id": sid,
            "name": entry.get("name", sid),
            "shell": entry.get("shell", ""),
            "encoding": entry.get("encoding", "utf-8"),
            "cwd": entry.get("cwd", "/"),
            "created_at": entry.get("created_at", 0),
            "idle_seconds": round(now - entry.get("last_activity", now), 0),
            "has_pty": not entry.get("is_pipe", True),
            "pid": entry["session"].pid,
        })
    # Sort newest first
    result.sort(key=lambda s: s["created_at"], reverse=True)
    return {"sessions": result, "max": TERMINAL_MAX_SESSIONS, "count": len(result)}


@rest_router.delete("/api/terminal/sessions/{session_id}")
async def kill_session(session_id: str):
    """Force-kill a terminal session by ID."""
    if session_id not in _sessions:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")

    try:
        ws = _sessions[session_id]["ws"]
        await ws.send_json({
            "type": "killed",
            "message": "会话已被管理员终止",
        })
    except Exception:
        pass

    await _cleanup_session(session_id)
    return {"status": "ok", "session_id": session_id}


# ═══════════════════════════════════════════════════════════
#  REST: Audit log
# ═══════════════════════════════════════════════════════════


@rest_router.get("/api/terminal/audit")
async def get_audit_log(
    session_id: str = Query("", description="Filter by session ID"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    dangerous_only: bool = Query(False, description="Only show dangerous commands"),
):
    """Query terminal command audit log."""
    from server.services.terminal_audit import query_audit
    from server.models.database import get_db

    db = get_db()
    return query_audit(
        db,
        session_id=session_id or None,
        limit=limit,
        offset=offset,
        dangerous_only=dangerous_only,
    )
