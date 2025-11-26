# 📄 tools/envcheck.py
# 목적: .env / OS 환경변수에 설정된 값들이 "강제통일 정답표"를 충족하는지 자동 검사
# 사용:
#   python tools/envcheck.py
#
# 동작 요약
# - python-dotenv가 있으면 .env(.env.local 우선) 자동 로드
# - 필수/형식/교차 검증
# - 오류가 있으면 비정상 종료 코드(1)로 종료
# - 비밀값은 마스킹 출력

from __future__ import annotations
import os
import re
import sys
from typing import List, Tuple, Dict

# ─────────────────────────────────────────────────────
# .env 로드 (python-dotenv 선택적)
# ─────────────────────────────────────────────────────
def try_load_dotenv() -> None:
    try:
        from dotenv import load_dotenv, find_dotenv
    except Exception:
        print("ℹ️  python-dotenv 미설치: OS 환경변수와 이미 로드된 값만 검사합니다.")
        return

    # .env.local → .env 우선
    # find_dotenv는 가장 가까운 .env를 찾음. .env.local은 직접 시도
    cwd = os.getcwd()
    env_local = os.path.join(cwd, ".env.local")
    if os.path.isfile(env_local):
        load_dotenv(env_local, override=False)

    env_default = find_dotenv(usecwd=True)
    if env_default:
        load_dotenv(env_default, override=False)

# ─────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────
def getenv(name: str) -> str | None:
    v = os.getenv(name)
    if v is None:
        return None
    return v.strip()

def is_int(v: str) -> bool:
    try:
        int(v)
        return True
    except Exception:
        return False

def mask(v: str, head: int = 2, tail: int = 2) -> str:
    if len(v) <= head + tail:
        return "*" * len(v)
    return f"{v[:head]}{'*' * (len(v) - head - tail)}{v[-tail:]}"

def split_csv(s: str) -> List[str]:
    return [x.strip() for x in s.split(",") if x.strip()]

def is_http_url(s: str) -> bool:
    return s.startswith("http://") or s.startswith("https://")

# ─────────────────────────────────────────────────────
# 규칙(정답표)
# ─────────────────────────────────────────────────────
REQUIRED_VARS = [
    # Backend 공통
    "APP_ENV",
    "HOST",
    "PORT",
    "LOG_LEVEL",
    "SECRET_KEY",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "DATABASE_URL",
    "REDIS_URL",
    "API_KEY",
    "CORS_ORIGINS",
    "RATE_LIMIT_REQUESTS",
    "RATE_LIMIT_WINDOW",
    # Frontend(Vite)
    "VITE_API_BASE_URL",
    "VITE_API_KEY",
]

VALID_APP_ENVS = {"development", "production"}
VALID_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}

def validate(values: Dict[str, str]) -> Tuple[List[str], List[str], List[str]]:
    """
    returns (missing, invalid, warnings)
    """
    missing: List[str] = []
    invalid: List[str] = []
    warnings: List[str] = []

    # 필수성
    for k in REQUIRED_VARS:
        if not values.get(k):
            missing.append(k)

    if missing:
        return missing, invalid, warnings  # 형식 검사는 빠진 항목 없이만

    # 형식 검사
    if values["APP_ENV"] not in VALID_APP_ENVS:
        invalid.append("APP_ENV (development 또는 production)")

    # HOST는 자유(0.0.0.0 권장), PORT 범위
    if not is_int(values["PORT"]) or not (1 <= int(values["PORT"]) <= 65535):
        invalid.append("PORT (1에서 65535)")

    if values["LOG_LEVEL"] not in VALID_LOG_LEVELS:
        invalid.append("LOG_LEVEL (DEBUG/INFO/WARNING/ERROR)")

    if len(values["SECRET_KEY"]) < 32:
        invalid.append("SECRET_KEY (32자 이상 무작위 문자열)")

    if not is_int(values["ACCESS_TOKEN_EXPIRE_MINUTES"]):
        invalid.append("ACCESS_TOKEN_EXPIRE_MINUTES (정수)")

    if not values["DATABASE_URL"].startswith("postgresql+asyncpg://"):
        invalid.append("DATABASE_URL (postgresql+asyncpg:// 로 시작)")

    if not values["REDIS_URL"].startswith("redis://"):
        invalid.append("REDIS_URL (redis:// 로 시작)")

    if not is_int(values["RATE_LIMIT_REQUESTS"]):
        invalid.append("RATE_LIMIT_REQUESTS (정수)")
    if not is_int(values["RATE_LIMIT_WINDOW"]):
        invalid.append("RATE_LIMIT_WINDOW (정수)")

    # CORS_ORIGINS
    cors = split_csv(values["CORS_ORIGINS"])
    if not cors:
        invalid.append("CORS_ORIGINS (쉼표로 구분된 URL 목록)")
    else:
        for u in cors:
            if not is_http_url(u):
                invalid.append(f"CORS_ORIGINS 항목 형식 오류: {u}")
                break

    # 프론트
    if not is_http_url(values["VITE_API_BASE_URL"]):
        invalid.append("VITE_API_BASE_URL (http:// 또는 https://)")

    # 교차/권고
    if values["APP_ENV"] == "production":
        if values["LOG_LEVEL"] == "DEBUG":
            warnings.append("production에서 LOG_LEVEL=DEBUG 권장하지 않음(최소 INFO).")
        # 로컬 호스트 허용 경고
        if any(u.startswith("http://localhost") or u.startswith("http://127.0.0.1") for u in cors):
            warnings.append("production에서 CORS_ORIGINS에 localhost/127.0.0.1 포함됨.")
        # 부트스트랩 계정 경고
        if getenv("ADMIN_BOOTSTRAP_USER") or getenv("ADMIN_BOOTSTRAP_PASSWORD"):
            warnings.append("production에서 ADMIN_BOOTSTRAP_* 설정은 권장하지 않음.")

    # 개발 편의 경고(선택)
    if values["APP_ENV"] == "development":
        if values["VITE_API_BASE_URL"].startswith("https://") and "localhost" in values["VITE_API_BASE_URL"]:
            warnings.append("개발에서 https 로컬 호출은 CORS/인증 문제를 야기할 수 있음.")

    return missing, invalid, warnings

def main() -> int:
    try_load_dotenv()

    # 환경수집
    values = {k: (getenv(k) or "") for k in REQUIRED_VARS}

    missing, invalid, warnings = validate(values)

    print("\n🔎 환경변수 점검 (강제통일 정답표)")
    print("────────────────────────────────────────")

    if missing:
        print("❌ 누락된 항목:")
        for k in missing:
            print(f"  - {k}")
        print("\n결과: 실패")
        return 1

    if invalid:
        print("❌ 형식 오류:")
        for k in invalid:
            print(f"  - {k}")
        print("\n결과: 실패")
        return 1

    # 성공 요약(민감값 마스킹)
    print("✅ 필수/형식 검사 통과!")
    safe_preview = {
        "APP_ENV": values["APP_ENV"],
        "HOST": values["HOST"],
        "PORT": values["PORT"],
        "LOG_LEVEL": values["LOG_LEVEL"],
        "SECRET_KEY": mask(values["SECRET_KEY"]),
        "ACCESS_TOKEN_EXPIRE_MINUTES": values["ACCESS_TOKEN_EXPIRE_MINUTES"],
        "DATABASE_URL": "postgresql+asyncpg://***",
        "REDIS_URL": "redis://***",
        "API_KEY": mask(values["API_KEY"]),
        "CORS_ORIGINS": values["CORS_ORIGINS"],
        "RATE_LIMIT_REQUESTS": values["RATE_LIMIT_REQUESTS"],
        "RATE_LIMIT_WINDOW": values["RATE_LIMIT_WINDOW"],
        "VITE_API_BASE_URL": values["VITE_API_BASE_URL"],
        "VITE_API_KEY": mask(values["VITE_API_KEY"]),
    }

    print("\n🔒 값 미리보기(민감값 마스킹):")
    for k, v in safe_preview.items():
        print(f"  - {k}: {v}")

    if warnings:
        print("\n⚠️ 권장 사항:")
        for w in warnings:
            print(f"  - {w}")

    print("\n결과: 성공")
    return 0

if __name__ == "__main__":
    sys.exit(main())
