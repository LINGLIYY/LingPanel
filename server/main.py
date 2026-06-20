"""LingServer Dashboard — Backend Application

FastAPI app factory with modular routers, CORS, rate limiting, and lifecycle events.
"""
import os
import time
import logging
import socket
import platform
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime

import bcrypt
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import (
    BASE_DIR, STATIC_DIR, HOST, PORT, DEBUG,
    BCRYPT_COST, DB_PATH, RATE_LIMIT_GLOBAL, RATE_LIMIT_LOGIN,
    ADMIN_PASSWORD,
)
from server.models.database import init_db
from server.middleware.rate_limit import RateLimiter, RateLimitMiddleware


# ═══════════════════════════════════════════════════════════
#  App Factory
# ═══════════════════════════════════════════════════════════

def create_app() -> FastAPI:
    # ── Enforce random SECRET_KEY in production ──
    _ensure_secret_key()

    # Import after _ensure_secret_key() so auth sees the resolved SECRET_KEY
    from server.auth import get_current_user  # noqa: E402

    app = FastAPI(
        title="LingServer Dashboard API",
        version="2.0.0",
        docs_url="/api/docs" if DEBUG else None,
        redoc_url=None,
    )

    # ── CORS ──
    if DEBUG:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        # Production: restrict origins, enable credentials for cookie auth
        _allowed_origins = os.getenv("LING_ALLOWED_ORIGINS", "http://localhost:8899,https://localhost:8899")
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in _allowed_origins.split(",") if o.strip()],
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
            allow_headers=["*"],
        )

    # ── Security Headers ──
    from server.middleware.security import SecurityHeadersMiddleware
    app.add_middleware(SecurityHeadersMiddleware)

    # ── Hide server identity in production ──
    if not DEBUG:

        @app.middleware("http")
        async def _hide_server_header(request, call_next):
            response = await call_next(request)
            response.headers["Server"] = "LingPanel"
            return response

    # ── Rate Limiting ──
    limiter = RateLimiter(
        default=RATE_LIMIT_GLOBAL,
        routes={"/api/auth/login": RATE_LIMIT_LOGIN},
    )
    app.add_middleware(RateLimitMiddleware, limiter=limiter)
    app.state.limiter = limiter

    # ── Init DB + admin before lifespan ──
    db = init_db()
    _ensure_default_admin(db)
    app.state.db = db
    app.state.boot_time = time.time()

    # ── Lifecycle ──
    @asynccontextmanager
    async def lifespan(ap: FastAPI):
        from server.routers.terminal import idle_checker
        from server.services.alert_engine import alert_loop, set_event_bus
        from server.services.metric_collector import MetricCollector
        from server.services.lifecycle import LifecycleCoordinator
        from server.ws import manager
        from server.events import EventBus

        # ── Create EventBus singleton (wraps WS manager) ──
        event_bus = EventBus(manager)
        ap.state.event_bus = event_bus

        # ── Inject into services that need it ──
        set_event_bus(event_bus)

        # ── Lifecycle coordinator ──
        coordinator = LifecycleCoordinator()

        # ── Start background tasks (order = dependency order) ──
        coordinator.register(idle_checker())
        coordinator.register(alert_loop(30))
        coordinator.register(MetricCollector(event_bus, interval=1.0).run())
        coordinator.register(_rate_limit_cleanup_loop(ap.state.limiter, interval=300))
        coordinator.register(_audit_cleanup_loop())
        coordinator.register(manager.heartbeat_loop())

        yield

        # ── Coordinated shutdown ──
        await coordinator.shutdown()

        # Only close file-based DBs; :memory: is shared across app instances
        from server.config import DB_PATH as _db_path
        from server.models.database import _shared_conn
        if _db_path != ":memory:" and hasattr(ap.state, "db") and ap.state.db:
            ap.state.db.close()
            import server.models.database as _db_mod
            _db_mod._shared_conn = None

    app.router.lifespan_context = lifespan

    # ── Favicon (public) ──
    @app.get("/favicon.ico")
    async def favicon():
        from fastapi.responses import Response
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
               '<rect width="32" height="32" rx="6" fill="#111827"/>'
               '<circle cx="16" cy="16" r="8" fill="#22c55e"/></svg>')
        return Response(content=svg, media_type="image/svg+xml")

    # ── Health (public) ──
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "2.0.0", "uptime": int(time.time() - app.state.boot_time)}

    # ── Static files ──
    css_dir = STATIC_DIR / "css"
    js_dir = STATIC_DIR / "js"
    dame_dir = STATIC_DIR / "dame"
    bg_dir = STATIC_DIR / "backgrounds"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")
    if dame_dir.exists():
        app.mount("/dame", StaticFiles(directory=str(dame_dir)), name="dame")
    if bg_dir.exists():
        app.mount("/backgrounds", StaticFiles(directory=str(bg_dir)), name="backgrounds")

    index_html = STATIC_DIR / "index.html"
    if index_html.exists():
        @app.get("/")
        async def serve_index():
            return FileResponse(str(index_html))

    # ── Auth routes (public) ──
    from server.routers.auth import router as auth_router
    app.include_router(auth_router)

    # ── System routes (protected) ──
    from server.routers.system import router as system_router
    app.include_router(system_router, dependencies=[Depends(get_current_user)])

    # ── WebSocket /ws/live ──
    from server.routers.system import _ws_router
    app.include_router(_ws_router)

    # ── File routes (protected) ──
    from server.routers.files import router as files_router
    app.include_router(files_router, dependencies=[Depends(get_current_user)])

    # ── Docker routes (protected) ──
    from server.routers.docker import router as docker_router
    app.include_router(docker_router, dependencies=[Depends(get_current_user)])

    # ── Log routes (protected) ──
    from server.routers.logs import router as logs_router
    app.include_router(logs_router, dependencies=[Depends(get_current_user)])

    # ── Alert routes (protected) ──
    from server.routers.alerts import router as alerts_router
    app.include_router(alerts_router, dependencies=[Depends(get_current_user)])

    # ── Terminal WebSocket /ws/terminal (public) ──
    from server.routers.terminal import router as terminal_router
    app.include_router(terminal_router)

    # ── Terminal session management REST API (protected) ──
    from server.routers.terminal import rest_router as terminal_rest_router
    app.include_router(terminal_rest_router, dependencies=[Depends(get_current_user)])

    # ── Process routes (protected) ──
    from server.routers.processes import router as processes_router
    app.include_router(processes_router, dependencies=[Depends(get_current_user)])

    # ── Service routes (protected) ──
    from server.routers.services import router as services_router
    app.include_router(services_router, dependencies=[Depends(get_current_user)])

    # ── Settings routes (protected) ──
    from server.routers.settings import router as settings_router
    app.include_router(settings_router, dependencies=[Depends(get_current_user)])

    return app


# ═══════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════

_bg_log = logging.getLogger("ling.background")

async def _rate_limit_cleanup_loop(limiter, interval: float = 300):
    """Background task: purge stale rate-limit keys every `interval` seconds."""
    import asyncio as _aio
    while True:
        await _aio.sleep(interval)
        try:
            cleaned = limiter.cleanup_expired()
            if cleaned:
                _bg_log.debug("Rate-limit cleanup: removed %d stale keys", cleaned)
        except Exception:
            _bg_log.warning("Rate-limit cleanup failed", exc_info=True)


async def _audit_cleanup_loop():
    """Background task: prune old records from audit/history tables.

    Retention policies:
      - metrics_history:  METRICS_RETENTION_DAYS (default 7)
      - terminal_audit:  90 days
      - alert_history:   90 days
      - login_audit:     180 days
    Runs immediately on startup, then every 6 hours.
    Batches deletes in chunks of 1000 to avoid WAL ballooning.
    """
    import asyncio as _aio
    from server.config import METRICS_RETENTION_DAYS
    from server.models.database import get_db

    # (table, column, retention_days)
    _PURGE_POLICIES = [
        ("metrics_history", "timestamp", METRICS_RETENTION_DAYS),
        ("terminal_audit", "timestamp", 90),
        ("alert_history", "triggered_at", 90),
        ("login_audit", "timestamp", 180),
    ]
    BATCH_SIZE = 1000

    while True:
        try:
            db = get_db()
            for table, col, days in _PURGE_POLICIES:
                while True:
                    cur = db.execute(
                        f"DELETE FROM {table} WHERE rowid IN "
                        f"(SELECT rowid FROM {table} WHERE {col} < datetime('now', ?) LIMIT {BATCH_SIZE})",
                        (f"-{days} days",),
                    )
                    if cur.rowcount < BATCH_SIZE:
                        break
                    db.commit()
            db.commit()
            _bg_log.debug("Audit cleanup completed")
        except Exception:
            _bg_log.warning("Audit cleanup failed", exc_info=True)
        await _aio.sleep(21600)  # Every 6 hours


def _ensure_secret_key():
    """Auto-generate a random SECRET_KEY if none is configured.

    In DEBUG mode, a weak but stable default is used so sessions survive restarts.
    In production (DEBUG=false), a random key is generated on every startup —
    this invalidates existing tokens but prevents the use of known defaults.
    Set LING_SECRET_KEY env var to persist tokens across restarts.
    """
    import secrets
    import sys as _sys
    from server.config import SECRET_KEY as _cfg_key
    import server.config as _cfg

    if _cfg_key:
        # Refuse known dev key in production
        if _cfg_key == "ling-server-dev-key--change-in-production" and not DEBUG:
            _sys.stderr.write(
                "  ❌ 生产环境不允许使用开发密钥！\n"
                "  ❌ 请设置环境变量 LING_SECRET_KEY 为随机字符串后重启\n"
            )
            _sys.stderr.flush()
            _sys.exit(1)
        return  # Explicitly configured — nothing to do

    if DEBUG:
        _cfg.SECRET_KEY = "ling-server-dev-key--change-in-production"
        os.environ["LING_SECRET_KEY"] = _cfg.SECRET_KEY
        _sys.stderr.write("  ⚠  DEBUG模式：使用固定开发密钥（Token 可被伪造）\n")
        _sys.stderr.flush()
    else:
        _cfg.SECRET_KEY = secrets.token_hex(32)
        os.environ["LING_SECRET_KEY"] = _cfg.SECRET_KEY
        _sys.stderr.write(f"  ⚠  未设置 LING_SECRET_KEY，已自动生成随机密钥\n")
        _sys.stderr.write(f"  ⚠  重启后所有 Token 失效，请设置环境变量持久化\n")
        _sys.stderr.flush()


def _ensure_default_admin(db):
    """Create default admin user if none exists.

    Password: $LING_ADMIN_PASSWORD env var, or auto-generated random password.
    Auto-generated passwords require change on first login.
    """
    row = db.execute("SELECT id, must_change_password FROM users WHERE username = 'admin'").fetchone()
    if not row:
        import secrets as _secrets
        env_pw = ADMIN_PASSWORD
        if env_pw:
            default_pw = env_pw
            # start.py 预生成时设置 LING_ADMIN_PW_AUTO=1，标记须修改
            must_change = 1 if os.getenv("LING_ADMIN_PW_AUTO") == "1" else 0
        else:
            default_pw = _secrets.token_urlsafe(12)
            must_change = 1

        # Pass to child processes via env var for hot-reload scenarios
        os.environ["LING_ADMIN_PASSWORD"] = default_pw

        pw_hash = bcrypt.hashpw(
            default_pw.encode(), bcrypt.gensalt(BCRYPT_COST)
        ).decode()
        db.execute(
            "INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, ?)",
            ("admin", pw_hash, must_change),
        )
        db.commit()

        # Store for banner — always show username + password on first startup
        import server.main as _main
        _main._admin_initial_password = default_pw
        _main._admin_is_new = True

        # Print immediately — use stderr so uvicorn doesn't swallow it
        import sys as _sys
        _sys.stderr.write(f"\n  +---------------------------------------+\n")
        _sys.stderr.write(f"  |  账号: admin                          |\n")
        _sys.stderr.write(f"  |  密码: {default_pw}                    |\n")
        if must_change:
            _sys.stderr.write(f"  |  !! 首次登录后请立即修改！            |\n")
        _sys.stderr.write(f"  +---------------------------------------+\n\n")
        _sys.stderr.flush()
    else:
        # Admin already exists — store flag so banner still shows the username
        import server.main as _main
        _main._admin_exists = True


_admin_initial_password = None
_admin_is_new = False
_admin_exists = False


# ═══════════════════════════════════════════════════════════
#  Runner
# ═══════════════════════════════════════════════════════════

app = create_app()

if __name__ == "__main__":
    import uvicorn
    # Build account info banner
    if _admin_is_new:
        pw_line = f"\n    |   账号: admin  密码: {_admin_initial_password}"
        pw_line += f"\n    |   !! 首次登录后请立即修改密码！"
    elif _admin_exists:
        pw_line = f"\n    |   账号: admin  密码: 已设置（遗忘可删除数据库重置）"
    else:
        pw_line = ""
    print(f"""
    +======================================+
    |   LingServer Dashboard API v2        |
    |   http://{HOST}:{PORT}                |
    |   Docs: http://{HOST}:{PORT}/api/docs |{pw_line}
    +======================================+
    """)
    uvicorn.run("server.main:app", host=HOST, port=PORT, reload=DEBUG,
                log_level="info", server_header=False)
