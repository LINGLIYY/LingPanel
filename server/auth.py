"""LingServer Dashboard — Authentication

JWT token creation/verification, bcrypt password hashing, and FastAPI dependency
for extracting the current user from cookies.
"""
import re
import time
import bcrypt
import jwt
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer

import server.config as _cfg

# Captured at import time — these never change
BCRYPT_COST = _cfg.BCRYPT_COST
ACCESS_TOKEN_EXPIRE_HOURS = _cfg.ACCESS_TOKEN_EXPIRE_HOURS
REFRESH_TOKEN_EXPIRE_DAYS = _cfg.REFRESH_TOKEN_EXPIRE_DAYS
# SECRET_KEY is intentionally NOT captured — it is mutated at runtime by
# _ensure_secret_key() in main.py. Always read _cfg.SECRET_KEY at call time.

ALGORITHM = "HS256"

# ── In-memory blacklist (cleared on restart — acceptable for single-admin panel) ──
_token_blacklist: set[str] = set()


# ═══════════════════════════════════════════════════════════
#  Password
# ═══════════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_COST)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ── Weak password blacklist (top common passwords, case-insensitive) ──
_WEAK_PASSWORDS: set[str] = {
    "password", "12345678", "123456789", "1234567890", "12345678901", "123456789012",
    "qwerty123", "qwerty12345", "admin123", "admin1234", "admin12345",
    "password123", "password1234", "password12345",
    "lingpanel", "lingserver", "ling-admin", "lingpanel123",
    "abc12345", "11111111", "111111111", "letmein1", "monkey1",
    "dragon1", "master1", "sunshine", "iloveyou",
    "trustno1", "welcome1", "football", "baseball",
    "starwars", "princess", "superman", "batman1",
    "changeme", "letmein", "qwertyuiop",
}

_PW_MIN_LENGTH = 12
_PW_MAX_LENGTH = 128


def validate_password_strength(password: str) -> str | None:
    """Validate password strength. Returns error message or None if valid.

    Requirements:
      - 12–128 characters
      - At least 3 of 4 character classes: uppercase, lowercase, digit, special
      - Not in weak-password blacklist
    """
    if len(password) < _PW_MIN_LENGTH:
        return f"密码长度至少 {_PW_MIN_LENGTH} 位"
    if len(password) > _PW_MAX_LENGTH:
        return f"密码长度不能超过 {_PW_MAX_LENGTH} 位"

    classes = 0
    if re.search(r"[A-Z]", password):
        classes += 1
    if re.search(r"[a-z]", password):
        classes += 1
    if re.search(r"[0-9]", password):
        classes += 1
    if re.search(r"[^A-Za-z0-9]", password):
        classes += 1
    if classes < 3:
        return "密码需包含以下四类中的至少三类：大写字母、小写字母、数字、特殊字符"

    if password.lower() in _WEAK_PASSWORDS:
        return "此密码过于常见，请选择更强的密码"

    return None


# ── User-level token revocation (password change → invalidate existing sessions) ──
_user_revoke: dict[int, float] = {}  # user_id → revoked_after_timestamp


def revoke_user_tokens(user_id: int):
    """Invalidate all existing tokens for a user (called after password change)."""
    _user_revoke[user_id] = time.time()


def _is_token_revoked(user_id: int, token_iat: int) -> bool:
    """Check whether a token was issued before the user's revocation timestamp."""
    revoked_at = _user_revoke.get(user_id)
    return revoked_at is not None and token_iat <= revoked_at


# ═══════════════════════════════════════════════════════════
#  JWT
# ═══════════════════════════════════════════════════════════

def create_access_token(user_id: int, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "type": "access",
        "iat": now,
        "exp": now + ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    }
    return jwt.encode(payload, _cfg.SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "type": "refresh",
        "iat": now,
        "exp": now + REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    }
    return jwt.encode(payload, _cfg.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises jwt.PyJWTError on failure."""
    if token in _token_blacklist:
        raise jwt.InvalidTokenError("Token has been revoked")
    payload = jwt.decode(token, _cfg.SECRET_KEY, algorithms=[ALGORITHM])
    # Check user-level revocation (password change invalidates all existing tokens)
    user_id = int(payload.get("sub", 0))
    token_iat = payload.get("iat", 0)
    if _is_token_revoked(user_id, token_iat):
        raise jwt.InvalidTokenError("Token has been revoked (password changed)")
    return payload


def blacklist_token(token: str) -> None:
    """Add a token to the revocation set."""
    _token_blacklist.add(token)


# ═══════════════════════════════════════════════════════════
#  FastAPI Dependency
# ═══════════════════════════════════════════════════════════

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(request: Request):
    """Extract and validate JWT from Cookie (preferred) or Authorization header.

    Returns {"user_id": int, "username": str} or raises 401.
    """
    token = None

    # 1. Try cookie first
    token = request.cookies.get("access_token")

    # 2. Fall back to Authorization header
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]

    if not token:
        raise HTTPException(status_code=401, detail="未登录，请先认证")

    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="请使用 access token")

    # Enforce must_change_password — backend guard (A7)
    from server.models.database import get_db
    db = get_db()
    row = db.execute(
        "SELECT must_change_password FROM users WHERE id = ?",
        (int(payload["sub"]),),
    ).fetchone()
    if row and row["must_change_password"]:
        path = request.url.path
        if path not in ("/api/auth/change-password", "/api/auth/logout", "/api/auth/me"):
            raise HTTPException(
                status_code=403,
                detail="首次登录请先修改密码",
                headers={"X-Must-Change-Password": "1"},
            )

    return {
        "user_id": int(payload["sub"]),
        "username": payload["username"],
    }


# ═══════════════════════════════════════════════════════════
#  WebSocket authentication helper
# ═══════════════════════════════════════════════════════════

def verify_ws_auth(ws) -> dict:
    """Authenticate a WebSocket connection via cookie or Authorization header.

    Must be called AFTER ws.accept().
    Returns {"user_id": int, "username": str} on success.
    Raises ValueError on failure.
    """
    token = None

    # 1. Try cookie (browser sends HttpOnly cookies on same-origin WS)
    token = ws.cookies.get("access_token")

    # 2. Fall back to Authorization header (for CLI tools / API clients)
    if not token:
        auth = ws.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]

    if not token:
        raise ValueError("缺少认证凭据")

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise ValueError("请使用 access token")

    return {"user_id": int(payload["sub"]), "username": payload["username"]}
