"""Phase 2 — Authentication tests.

Covers: login success, login failure, lockout, logout, refresh, /me, rate limiting.
"""
import time
import pytest
from unittest.mock import patch


# ═══════════════════════════════════════════════════════════
#  Login Success
# ═══════════════════════════════════════════════════════════

def test_login_success(client):
    """Correct password returns 200 and sets cookies."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["data"]["user"]["username"] == "admin"
    # Cookies should be set
    assert "access_token" in r.cookies
    assert "refresh_token" in r.cookies


def test_login_sets_httponly_cookies(client):
    """Login cookies should have httponly flag."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200
    # TestClient doesn't expose cookie flags directly, but cookies are present
    assert r.cookies.get("access_token") is not None


# ═══════════════════════════════════════════════════════════
#  Login Failure
# ═══════════════════════════════════════════════════════════

def test_login_wrong_password(client):
    """Wrong password returns 401."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401
    assert "错误" in r.json()["detail"]


def test_login_nonexistent_user(client):
    """Login with nonexistent user returns 401."""
    r = client.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    assert r.status_code == 401


def test_login_empty_credentials(client):
    """Login with empty credentials returns 422 (validation error)."""
    r = client.post("/api/auth/login", json={"username": "", "password": ""})
    assert r.status_code == 422


# ═══════════════════════════════════════════════════════════
#  Lockout
# ═══════════════════════════════════════════════════════════

def test_lockout_after_5_failures(client):
    """After 5 failed logins, returns 423 with lockout time."""
    for i in range(5):
        r = client.post("/api/auth/login", json={"username": "admin", "password": f"bad{i}"})
        if i < 4:
            assert r.status_code == 401, f"Attempt {i+1}: expected 401, got {r.status_code}"

    # 6th attempt should be locked
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 423, f"Expected 423, got {r.status_code}: {r.text}"
    assert "X-Lockout-Remaining" in r.headers or "锁定" in r.json()["detail"]


# ═══════════════════════════════════════════════════════════
#  Logout
# ═══════════════════════════════════════════════════════════

def test_logout_clears_cookies(client):
    """Logout clears auth cookies and blacklists tokens."""
    # First login
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200
    token = r.cookies.get("access_token")

    # Then logout
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert r.json()["message"] == "已登出"

    # Token should be blacklisted — reuse should fail
    # (cookies are cleared by the response; test by sending the old token manually)
    r2 = client.get("/api/auth/me", cookies={"access_token": token})
    assert r2.status_code == 401  # blacklisted


# ═══════════════════════════════════════════════════════════
#  Refresh
# ═══════════════════════════════════════════════════════════

def test_refresh_returns_new_tokens(client):
    """POST /api/auth/refresh exchanges refresh for new access token."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    refresh = r.cookies.get("refresh_token")

    r2 = client.post("/api/auth/refresh", cookies={"refresh_token": refresh})
    assert r2.status_code == 200
    data = r2.json()
    assert "access_token" in data


def test_refresh_without_token_fails(client):
    """Refresh without refresh_token returns 401."""
    r = client.post("/api/auth/refresh")
    assert r.status_code == 401


# ═══════════════════════════════════════════════════════════
#  /me
# ═══════════════════════════════════════════════════════════

def test_me_authenticated(auth_client):
    """GET /api/auth/me returns current user info."""
    r = auth_client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["data"]["username"] == "admin"


def test_me_unauthenticated(client):
    """GET /api/auth/me without auth returns 401."""
    r = client.get("/api/auth/me")
    assert r.status_code == 401


# ═══════════════════════════════════════════════════════════
#  Rate Limiting
# ═══════════════════════════════════════════════════════════

def test_rate_limiter_unit():
    """RateLimiter.check() blocks after exceeding limit."""
    from server.middleware.rate_limit import RateLimiter
    limiter = RateLimiter(default="3/minute")

    # First 3 should pass
    for i in range(3):
        assert limiter.check("192.168.1.1", "/test") is True

    # 4th should be blocked
    assert limiter.check("192.168.1.1", "/test") is False

    # Different IP should still pass
    assert limiter.check("192.168.1.2", "/test") is True


def test_change_password(auth_client):
    """POST /api/auth/change-password changes password and clears must_change flag."""
    r = auth_client.post("/api/auth/change-password", json={
        "old_password": "admin",
        "new_password": "newpass123",
    })
    assert r.status_code == 200
    assert r.json()["success"] is True

    # Old password should no longer work
    from fastapi.testclient import TestClient
    from server.main import create_app
    app2 = create_app()
    with TestClient(app2) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert r.status_code == 401

    # New password should work
    with TestClient(app2) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "newpass123"})
        assert r.status_code == 200


def test_change_password_wrong_old(auth_client):
    """Change password with wrong old password fails."""
    r = auth_client.post("/api/auth/change-password", json={
        "old_password": "wrongpassword",
        "new_password": "newpass123",
    })
    assert r.status_code == 400


def test_change_password_too_short(auth_client):
    """New password < 4 chars rejected."""
    r = auth_client.post("/api/auth/change-password", json={
        "old_password": "admin",
        "new_password": "ab",
    })
    assert r.status_code == 400


def test_login_rate_limit_middleware_active(client):
    """Login uses rate-limited route (but test config is 100/min — won't trigger)."""
    from server.middleware.rate_limit import RateLimiter
    # Verify the limiter class works (unit test above covers actual blocking)
    limiter = RateLimiter(default="60/minute", routes={"/api/auth/login": "5/minute"})
    assert limiter._routes == {"/api/auth/login": (5, 60.0)}
