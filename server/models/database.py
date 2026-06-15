"""LingServer Dashboard — Database Setup

SQLite with manual schema versioning.
Migrations are applied in order on startup.
"""
import sqlite3
import os

from server.config import DB_PATH

SCHEMA_VERSION = 5

MIGRATIONS = {
    1: [
        """CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            totp_secret   TEXT,
            totp_enabled  INTEGER DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            last_login    TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS login_audit (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT NOT NULL,
            ip_address  TEXT,
            user_agent  TEXT,
            success     INTEGER NOT NULL DEFAULT 0,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
        """CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )""",
    ],
    2: [
        """CREATE TABLE IF NOT EXISTS metrics_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp    TEXT NOT NULL DEFAULT (datetime('now')),
            cpu_percent  REAL,
            mem_percent  REAL,
            mem_used_gb  REAL,
            disk_percent REAL,
            disk_used_gb REAL,
            net_down_kbs REAL,
            net_up_kbs   REAL,
            load_1m      REAL,
            load_5m      REAL,
            load_15m     REAL
        )""",
        """CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_history(timestamp)""",
    ],
    3: [
        """ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0""",
    ],
    4: [
        """CREATE TABLE IF NOT EXISTS alert_rules (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            metric           TEXT NOT NULL,
            condition        TEXT NOT NULL DEFAULT '>',
            threshold        REAL NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 30,
            action_type      TEXT NOT NULL DEFAULT 'browser',
            action_config    TEXT,
            enabled          INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
        """CREATE TABLE IF NOT EXISTS alert_history (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id       INTEGER NOT NULL,
            rule_name     TEXT NOT NULL,
            metric        TEXT NOT NULL,
            threshold     REAL NOT NULL,
            actual_value  REAL,
            state         TEXT NOT NULL DEFAULT 'fired',
            message       TEXT,
            triggered_at  TEXT NOT NULL DEFAULT (datetime('now')),
            recovered_at  TEXT,
            acknowledged_at TEXT,
            FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
        )""",
        """CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id)""",
        """CREATE INDEX IF NOT EXISTS idx_alert_history_ts ON alert_history(triggered_at)""",
    ],
    5: [
        """CREATE TABLE IF NOT EXISTS terminal_audit (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id    TEXT NOT NULL,
            username      TEXT NOT NULL DEFAULT 'unknown',
            input_text    TEXT NOT NULL,
            is_dangerous  INTEGER NOT NULL DEFAULT 0,
            cwd           TEXT,
            timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
        """CREATE INDEX IF NOT EXISTS idx_term_audit_session ON terminal_audit(session_id)""",
        """CREATE INDEX IF NOT EXISTS idx_term_audit_ts ON terminal_audit(timestamp)""",
    ],
}

# Singleton for :memory: (each connect(':memory:') is a separate database)
_shared_conn: sqlite3.Connection | None = None


def _get_version(conn: sqlite3.Connection) -> int:
    try:
        row = conn.execute(
            "SELECT MAX(version) FROM schema_version"
        ).fetchone()
        return row[0] if row[0] is not None else 0
    except sqlite3.OperationalError:
        return 0


def _apply_migrations(conn: sqlite3.Connection):
    current = _get_version(conn)
    for ver in sorted(MIGRATIONS.keys()):
        if ver > current:
            for sql in MIGRATIONS[ver]:
                conn.execute(sql)
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                (ver,),
            )
    conn.commit()


def _connect(db_path: str) -> sqlite3.Connection:
    """Open a SQLite connection with safe defaults for multi-thread access."""
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> sqlite3.Connection:
    """Open DB, run pending migrations, return connection.

    For :memory: databases, caches the connection globally since
    each new sqlite3.connect(':memory:') creates a separate database.
    """
    global _shared_conn

    if DB_PATH == ":memory:" and _shared_conn is not None:
        return _shared_conn

    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = _connect(DB_PATH)
    _apply_migrations(conn)

    if DB_PATH == ":memory:":
        _shared_conn = conn

    return conn


def get_db() -> sqlite3.Connection:
    """Return the shared DB connection (singleton for both :memory: and file).

    Opens once on first call, reuses thereafter.
    WAL mode + check_same_thread=False allows safe concurrent reads.
    """
    global _shared_conn

    if _shared_conn is not None:
        return _shared_conn

    return init_db()
