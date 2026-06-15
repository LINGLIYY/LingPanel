"""LingServer Dashboard — Authentication

JWT token creation/verification, bcrypt password hashing, and FastAPI dependency
for extracting the current user from cookies.
"""
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
    return jwt.decode(token, _cfg.SECRET_KEY, algorithms=[ALGORITHM])


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
