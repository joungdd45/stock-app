# core/security.py
from datetime import datetime, timedelta, timezone
import os
from jose import jwt
from passlib.context import CryptContext

# ─────────────────────────────────────────────────────────────
# JWT 설정
# ─────────────────────────────────────────────────────────────
ALGORITHM = "HS256"
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE_ME_SECRET")  # .env로 대체 권장
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# ─────────────────────────────────────────────────────────────
# 비밀번호 해시 컨텍스트
# - 기본 스킴: bcrypt_sha256 (긴 비밀번호 안전)
# - 레거시 호환: 기존 bcrypt 해시도 검증 가능
# ─────────────────────────────────────────────────────────────
pwd_context = CryptContext(
    schemes=["bcrypt_sha256", "bcrypt"],
    default="bcrypt_sha256",
    deprecated="auto",
)

def hash_password(plain: str) -> str:
    """사용자 비밀번호를 해시한다."""
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    """평문 비밀번호와 저장된 해시를 검증한다."""
    return pwd_context.verify(plain, hashed)

def create_access_token(subject: str, role: str, must_change: bool) -> str:
    """JWT Access Token 생성."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "role": role,
        "must_change": must_change,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
