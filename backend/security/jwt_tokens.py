# 📄 backend/security/jwt_tokens.py
# 역할: JWT access / refresh 토큰 생성 및 검증
# 주의:
# - 환경변수 기반 설정 (JWT_SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS)
# - PyJWT 사용

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import jwt

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 환경 변수 설정
# ─────────────────────────────────────────────────────────

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


def _get_secret() -> str:
    """
    JWT 서명에 사용할 시크릿 키 가져오기.
    설정되지 않았으면 DomainError로 처리.
    """
    if not JWT_SECRET_KEY:
        raise DomainError(
            "SYSTEM-CONFIG-001",
            detail="JWT_SECRET_KEY 환경변수가 설정되지 않았습니다.",
            ctx={"env": "JWT_SECRET_KEY"},
        )
    return JWT_SECRET_KEY


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────
# 토큰 생성
# ─────────────────────────────────────────────────────────

def create_access_token(
    *,
    subject: str,
    username: str,
    role: str | None,
) -> str:
    """
    access_token 생성용 JWT
    - subject: 일반적으로 user_id
    """
    now = _now_utc()
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: Dict[str, Any] = {
        "sub": subject,
        "username": username,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }

    token = jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)
    return token


def create_refresh_token(
    *,
    subject: str,
    username: str,
    role: str | None,
) -> str:
    """
    refresh_token 생성용 JWT
    """
    now = _now_utc()
    expire = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    payload: Dict[str, Any] = {
        "sub": subject,
        "username": username,
        "role": role,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }

    token = jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)
    return token


# ─────────────────────────────────────────────────────────
# 토큰 검증 (decode)
# ─────────────────────────────────────────────────────────

def _decode_token(token: str, expected_type: str) -> Dict[str, Any]:
    """
    공통 decode 로직
    - type(access / refresh)도 함께 검증
    """
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise DomainError(
            "AUTH-TOKEN-002",
            detail="토큰이 만료되었습니다.",
            ctx={"type": expected_type},
        )
    except jwt.InvalidTokenError as e:
        raise DomainError(
            "AUTH-TOKEN-001",
            detail="유효하지 않은 토큰입니다.",
            ctx={"type": expected_type, "error": str(e)},
        )

    token_type = payload.get("type")
    if token_type != expected_type:
        raise DomainError(
            "AUTH-TOKEN-003",
            detail="토큰 타입이 올바르지 않습니다.",
            ctx={"expected": expected_type, "actual": token_type},
        )

    return payload


def decode_access_token(token: str) -> Dict[str, Any]:
    return _decode_token(token, "access")


def decode_refresh_token(token: str) -> Dict[str, Any]:
    return _decode_token(token, "refresh")
