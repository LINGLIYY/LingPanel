"""LingServer Dashboard — Test Configuration

Provides FastAPI TestClient, authenticated client, and fresh DB for all tests.
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["LING_DB_PATH"] = ":memory:"
os.environ["LING_SECRET_KEY"] = "test-secret-key-change-me"
os.environ["LING_ADMIN_PASSWORD"] = "admin"
os.environ["LING_RATE_GLOBAL"] = "1000/minute"
os.environ["LING_RATE_LOGIN"] = "100/minute"

from fastapi.testclient import TestClient
from server.main import create_app


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset in-memory state before each test."""
    # Reset lockout stores
    import server.routers.auth as auth_mod
    auth_mod._lockout.clear()
    auth_mod._user_failures.clear()

    # Reset token blacklist + user revocation + password change rate tracker
    import server.auth as auth_pkg
    auth_pkg._token_blacklist.clear()
    auth_pkg._user_revoke.clear()
    auth_mod._change_pw_tracker.clear()

    # Reset admin password to default (tests may change it)
    from server.models.database import get_db
    from server.auth import hash_password
    db = get_db()
    row = db.execute("SELECT id, password_hash FROM users WHERE username = 'admin'").fetchone()
    if row:
        # Only reset if password isn't already 'admin'
        import bcrypt
        if not bcrypt.checkpw(b"admin", row["password_hash"].encode()):
            pw = hash_password("admin")
            db.execute("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", (pw, row["id"]))
            db.commit()


@pytest.fixture
def app():
    """Fresh FastAPI app per test."""
    return create_app()


@pytest.fixture
def client(app):
    """Unauthenticated TestClient."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_client(app):
    """Authenticated TestClient — logs in as admin, attaches token cookie."""
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert r.status_code == 200, f"Auth fixture login failed: {r.status_code} {r.text}"
        yield c


@pytest.fixture
def db():
    """Direct DB connection for setup/teardown.

    For :memory: databases, returns the shared connection (do NOT close).
    For file-based DBs, opens a fresh connection and closes after test.
    """
    from server.models.database import init_db, DB_PATH
    from server.models.database import _shared_conn
    conn = init_db()
    yield conn
    # Never close the shared :memory: connection — other fixtures rely on it
    if DB_PATH != ":memory:" or conn is not _shared_conn:
        conn.close()
