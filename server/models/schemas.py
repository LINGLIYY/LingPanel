"""LingServer Dashboard — Pydantic Schemas

Request/response models for API endpoints.
"""
from pydantic import BaseModel, Field
from typing import Optional


# ── Auth ──
class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)
    remember: bool = False


class UserInfo(BaseModel):
    username: str
    last_login: Optional[str] = None
    totp_enabled: bool = False


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserInfo
    require_2fa: bool = False
    temp_token: Optional[str] = None


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
