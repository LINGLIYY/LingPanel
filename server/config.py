"""LingServer Dashboard — Server Configuration

All settings read from environment variables with sensible defaults.
"""
import json
import os
from pathlib import Path

# ── Paths ──
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR  # index.html, css/, js/ live at project root
DB_PATH = os.getenv("LING_DB_PATH", str(BASE_DIR / "ling-server.db"))

# ── Security ──
SECRET_KEY = os.getenv("LING_SECRET_KEY", "")  # empty → auto-generate at startup
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("LING_ACCESS_EXPIRE_HOURS", "2"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("LING_REFRESH_EXPIRE_DAYS", "3"))
BCRYPT_COST = int(os.getenv("LING_BCRYPT_COST", "12"))
MAX_LOGIN_FAILURES = int(os.getenv("LING_MAX_LOGIN_FAILURES", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.getenv("LING_LOGIN_LOCKOUT_MINUTES", "15"))
ADMIN_PASSWORD = os.getenv("LING_ADMIN_PASSWORD", "")  # empty → auto-generate at startup

# ── Rate Limiting ──
RATE_LIMIT_GLOBAL = os.getenv("LING_RATE_GLOBAL", "60/minute")
RATE_LIMIT_LOGIN = os.getenv("LING_RATE_LOGIN", "10/minute")

# ── Server ──
HOST = os.getenv("LING_HOST", "0.0.0.0")
PORT = int(os.getenv("LING_PORT", "8899"))
DEBUG = os.getenv("LING_DEBUG", "false").lower() == "true"

# ── File Browser ──
FILE_PREVIEW_MAX_MB = int(os.getenv("LING_FILE_PREVIEW_MB", "10"))
FILE_UPLOAD_MAX_MB = int(os.getenv("LING_FILE_UPLOAD_MB", "500"))
FILE_UPLOAD_ALLOWED_EXTENSIONS = os.getenv(
    "LING_FILE_UPLOAD_EXTENSIONS",
    ".txt,.log,.conf,.cfg,.ini,.json,.yaml,.yml,.xml,.csv,.md,.py,.sh,.js,.css,.html,.env,.toml",
).split(",")
FILE_UPLOAD_BLOCKED_EXTENSIONS = os.getenv(
    "LING_FILE_UPLOAD_BLOCKED",
    ".exe,.dll,.so,.bin,.bat,.cmd,.ps1,.com,.msi,.app,.pkg,.deb,.rpm",
).split(",")
FILE_ROOT_WHITELIST = os.getenv(
    "LING_FILE_WHITELIST",
    "/home,/var,/etc,/opt,/tmp,/usr,/srv",
).split(",")

# ── Logs ──
_DEFAULT_LOG_SOURCES = [
    {"id": "syslog",   "path": "/var/log/syslog",     "label": "Syslog"},
    {"id": "auth",     "path": "/var/log/auth.log",   "label": "Auth Log"},
    {"id": "nginx-ac", "path": "/var/log/nginx/access.log", "label": "Nginx Access"},
    {"id": "nginx-er", "path": "/var/log/nginx/error.log",  "label": "Nginx Error"},
]
LOG_SOURCES = json.loads(os.getenv("LING_LOG_SOURCES", json.dumps(_DEFAULT_LOG_SOURCES)))
LOG_TAIL_LINES = int(os.getenv("LING_LOG_TAIL", "500"))
LOG_MAX_FILE_MB = int(os.getenv("LING_LOG_MAX_MB", "100"))

# ── Backgrounds ──
BACKGROUNDS_DIR = os.getenv("LING_BACKGROUNDS_DIR", str(BASE_DIR / "backgrounds"))

# ── Terminal ──
TERMINAL_MAX_SESSIONS = int(os.getenv("LING_TERM_MAX_SESSIONS", "5"))
TERMINAL_IDLE_TIMEOUT_MINUTES = int(os.getenv("LING_TERM_TIMEOUT", "30"))

# ── Docker ──
DOCKER_SOCKET = os.getenv("DOCKER_HOST", "unix:///var/run/docker.sock")

# ── Metrics History ──
METRICS_RETENTION_DAYS = int(os.getenv("LING_METRICS_RETENTION", "7"))
METRICS_COLLECT_INTERVAL_SECONDS = int(os.getenv("LING_METRICS_INTERVAL", "60"))
