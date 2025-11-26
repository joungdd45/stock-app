# 📄 backend/db/session.py
# 목적: 동기(Session) + 비동기(AsyncSession) 세션팩토리 동시 제공
# 규칙: 한 요청 처리에서는 동기/비동기 혼용 금지(라우터별로 고정 주입)
# NOAH PATCH START v1.0

from __future__ import annotations
import os
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)

# ─────────────────────────────────────────────────────────────
# ENV 해석
# - 필수: DB_URL_SYNC (예: postgresql+psycopg2://user:pass@host:5432/db)
# - 선택: DB_URL_ASYNC (없으면 자동 파생)
#   파생 규칙: +psycopg2 → +asyncpg 치환
# ─────────────────────────────────────────────────────────────
DB_URL_SYNC: Optional[str] = (
    os.getenv("DB_URL_SYNC")
    or os.getenv("DBURL")
    or os.getenv("DATABASE_URL")
)
if not DB_URL_SYNC:
    # 개발 편의 기본값
    DB_URL_SYNC = "postgresql+psycopg2://postgres:postgres@postgres:5432/postgres"

DB_URL_ASYNC: Optional[str] = os.getenv("DB_URL_ASYNC")
if not DB_URL_ASYNC:
    # sync URL에서 드라이버만 asyncpg로 교체
    if "+psycopg2" in DB_URL_SYNC:
        DB_URL_ASYNC = DB_URL_SYNC.replace("+psycopg2", "+asyncpg")
    elif DB_URL_SYNC.startswith("postgresql://"):
        DB_URL_ASYNC = DB_URL_SYNC.replace("postgresql://", "postgresql+asyncpg://", 1)
    else:
        # 최후의 수단(명시적 async URL이 없고 패턴도 다르면 에러 방지용)
        raise RuntimeError(
            "DB_URL_ASYNC 미지정, 그리고 DB_URL_SYNC로부터 async URL을 유도할 수 없습니다. "
            "환경변수 DB_URL_ASYNC를 설정하세요."
        )

# ─────────────────────────────────────────────────────────────
# Sync 엔진/세션팩토리
# ─────────────────────────────────────────────────────────────
sync_engine = create_engine(
    DB_URL_SYNC,
    pool_size=10,
    max_overflow=20,
    future=True,
    echo=False,
)
SessionLocal = sessionmaker(
    bind=sync_engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)

def get_sync_session():
    """
    동기 세션 의존성(예: 스캔 원자 처리, 행 잠금 등)
    라우터에서: `db: Session = Depends(get_sync_session)`
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def ping_sync() -> bool:
    """
    동기 커넥션 헬스체크(옵션)
    """
    try:
        with sync_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

# ─────────────────────────────────────────────────────────────
# Async 엔진/세션팩토리
# ─────────────────────────────────────────────────────────────
async_engine = create_async_engine(
    DB_URL_ASYNC,
    pool_size=10,
    max_overflow=20,
    future=True,
    echo=False,
)
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)

async def get_async_session():
    """
    비동기 세션 의존성(예: 대량 조회, 목록, 통계, XLSX export 등)
    라우터에서: `db: AsyncSession = Depends(get_async_session)`
    """
    async with AsyncSessionLocal() as session:
        yield session

async def ping_async() -> bool:
    """
    비동기 커넥션 헬스체크(옵션)
    """
    try:
        async with async_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

# ─────────────────────────────────────────────────────────────
# 종료 훅(옵션): 애플리케이션 종료 시 커넥션 풀 정리에 사용
# ─────────────────────────────────────────────────────────────
def dispose_sync_engine():
    try:
        sync_engine.dispose()
    except Exception:
        pass

async def dispose_async_engine():
    try:
        await async_engine.dispose()  # type: ignore[attr-defined]
    except Exception:
        pass

# NOAH PATCH END v1.0
