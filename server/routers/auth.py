"""LingServer Dashboard — Authentication Routes

POST /api/auth/login   — authenticate and set cookies
POST /api/auth/logout  — clear cookies, blacklist tokens
POST /api/auth/refresh — exchange refresh token for new access token
GET  /api/auth/me      — current user info
"""
import time
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from fastapi.responses import JSONResponse

from server.config import (
    MAX_LOGIN_FAILURES, LOGIN_LOCKOUT_MINUTES,
    ACCESS_TOKEN_EXPIRE_HOURS, REFRESH_TOKEN_EXPIRE_DAYS,
)
from server.auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    decode_token, blacklist_token,
    get_current_user,
)
from server.models.schemas import LoginRequest, LoginResponse, UserInfo, TokenRefreshRequest, TokenRefreshResponse
from server.models.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── In-memory lockout store ──
_lockout: dict[str, dict] = {}  # ip → {failures, locked_until}


def _check_lockout(client_ip: str):
    """Raise 423 if IP is locked out. O(1) — no eager cleanup (stale entries are tiny)."""
    now = time.time()
    entry = _lockout.get(client_ip)
    if entry and entry.get("locked_until", 0) > now:
        remaining = int(entry["locked_until"] - now)
        raise HTTPException(
            status_code=423,
            detail=f"登录已被锁定，请 {remaining} 秒后再试",
            headers={"X-Lockout-Remaining": str(remaining)},
        )
    return entry["failures"] if entry else 0


def _record_failure(client_ip: str):
    failures = _lockout.get(client_ip, {}).get("failures", 0) + 1
    entry = {"failures": failures}
    if failures >= MAX_LOGIN_FAILURES:
        entry["locked_until"] = time.time() + LOGIN_LOCKOUT_MINUTES * 60
    _lockout[client_ip] = entry


def _clear_failures(client_ip: str):
    _lockout.pop(client_ip, None)


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str,
                       request: Request, remember: bool = False):
    """Set HttpOnly cookies on the response.

    secure=True when behind HTTPS (production with nginx proxy).
    """
    access_max = ACCESS_TOKEN_EXPIRE_HOURS * 3600
    refresh_max = REFRESH_TOKEN_EXPIRE_DAYS * 86400

    # Detect HTTPS: check X-Forwarded-Proto header (nginx), then request URL scheme
    is_https = (
        request.headers.get("X-Forwarded-Proto", "").lower() == "https"
        or request.url.scheme == "https"
    )

    response.set_cookie(
        key="access_token", value=access_token,
        httponly=True, samesite="strict", secure=is_https,
        max_age=access_max, path="/",
    )
    response.set_cookie(
        key="refresh_token", value=refresh_token,
        httponly=True, samesite="strict", secure=is_https,
        max_age=refresh_max, path="/api/auth",  # only sent to auth endpoints
    )


def _clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/auth")


# ═══════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════

@router.post("/login")
async def login(request: Request, body: LoginRequest):
    """Authenticate user, return tokens via HttpOnly cookies."""
    client_ip = request.client.host if request.client else "unknown"

    # Check lockout
    _check_lockout(client_ip)

    db = get_db()

    row = db.execute(
        "SELECT id, username, password_hash, last_login, totp_enabled, must_change_password FROM users WHERE username = ?",
        (body.username,),
    ).fetchone()

    if not row or not verify_password(body.password, row["password_hash"]):
        _record_failure(client_ip)
        # Audit
        db.execute(
            "INSERT INTO login_audit (username, ip_address, success) VALUES (?,?,0)",
            (body.username, client_ip),
        )
        db.commit()

        failures = _lockout.get(client_ip, {}).get("failures", 0)
        remaining = max(0, MAX_LOGIN_FAILURES - failures)

        status = 423 if failures >= MAX_LOGIN_FAILURES else 401
        detail = f"用户名或密码错误，剩余尝试 {remaining} 次"
        if status == 423:
            detail = f"登录已锁定 {LOGIN_LOCKOUT_MINUTES} 分钟"

        raise HTTPException(status_code=status, detail=detail)

    # Success
    _clear_failures(client_ip)

    access_token = create_access_token(row["id"], row["username"])
    refresh_token = create_refresh_token(row["id"], row["username"])

    # Audit
    db.execute(
        "INSERT INTO login_audit (username, ip_address, success) VALUES (?,?,1)",
        (body.username, client_ip),
    )
    db.execute(
        "UPDATE users SET last_login = datetime('now') WHERE id = ?",
        (row["id"],),
    )
    db.commit()

    response = JSONResponse({
        "success": True,
        "data": {
            "user": {
                "username": row["username"],
                "last_login": row["last_login"],
                "totp_enabled": bool(row["totp_enabled"]),
                "must_change_password": bool(row["must_change_password"]),
            },
        },
    })
    _set_auth_cookies(response, access_token, refresh_token, request, body.remember)
    return response


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Clear cookies and blacklist tokens."""
    access_token = request.cookies.get("access_token")
    refresh_token = request.cookies.get("refresh_token")

    if access_token:
        blacklist_token(access_token)
    if refresh_token:
        blacklist_token(refresh_token)

    _clear_auth_cookies(response)
    return {"success": True, "message": "已登出"}


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(request: Request):
    """Exchange a valid refresh token for a new access token."""
    refresh_token = request.cookies.get("refresh_token")

    if not refresh_token:
        raise HTTPException(status_code=401, detail="无 refresh token")

    try:
        payload = decode_token(refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Refresh token 无效或已过期")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="请使用 refresh token")

    user_id = int(payload["sub"])
    username = payload["username"]

    new_access = create_access_token(user_id, username)
    new_refresh = create_refresh_token(user_id, username)

    # Blacklist old tokens
    blacklist_token(refresh_token)

    response = JSONResponse({
        "access_token": new_access,
        "token_type": "bearer",
    })
    _set_auth_cookies(response, new_access, new_refresh, request)
    return response


@router.get("/audit")
async def audit_log(page: int = 1, size: int = 50, _user=Depends(get_current_user)):
    """View login audit history (paginated)."""
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM login_audit").fetchone()[0]
    offset = (page - 1) * size
    rows = db.execute(
        "SELECT * FROM login_audit ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (size, offset),
    ).fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "username": r["username"],
            "ip_address": r["ip_address"],
            "user_agent": r["user_agent"],
            "success": bool(r["success"]),
            "timestamp": r["timestamp"],
        })
    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "pages": max(1, (total + size - 1) // size),
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    """Return current authenticated user info."""
    db = get_db()
    row = db.execute(
        "SELECT username, last_login, totp_enabled, must_change_password FROM users WHERE id = ?",
        (user["user_id"],),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "success": True,
        "data": {
            "username": row["username"],
            "last_login": row["last_login"],
            "totp_enabled": bool(row["totp_enabled"]),
            "must_change_password": bool(row["must_change_password"]),
        },
    }


@router.post("/change-password")
async def change_password(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Change current user's password."""
    body = await request.json()
    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if not old_password or not new_password:
        raise HTTPException(400, "请提供当前密码和新密码")
    if len(new_password) < 8:
        raise HTTPException(400, "新密码长度至少 8 位")

    db = get_db()
    row = db.execute(
        "SELECT password_hash FROM users WHERE id = ?",
        (user["user_id"],),
    ).fetchone()
    if not row:
        raise HTTPException(404, "用户不存在")

    if not verify_password(old_password, row["password_hash"]):
        raise HTTPException(400, "当前密码不正确")

    new_hash = hash_password(new_password)
    db.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
        (new_hash, user["user_id"]),
    )
    db.commit()
    return {"success": True, "message": "密码已修改"}
