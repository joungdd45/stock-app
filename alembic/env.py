# 📄 C:\dev\stock-app\alembic\env.py
# 목적: Alembic이 backend/models.py의 Base.metadata를 읽어
#       autogenerate를 정상적으로 수행하도록 하는 설정 파일

from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlalchemy import create_engine
from alembic import context

# ------------------------------------------------------------
# Alembic 기본 설정
# ------------------------------------------------------------
config = context.config

# 로깅 설정
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ------------------------------------------------------------
# 🔥 우리의 models.py(Base) 가져오기
# ------------------------------------------------------------
# DJ 프로젝트 기준 경로: backend/models.py
from backend.models import Base  # ← 이게 핵심
target_metadata = Base.metadata

# ------------------------------------------------------------
# 🔥 DB URL 가져오기
# ------------------------------------------------------------
# 우선순위:
# 1) 환경변수 DATABASE_URL
# 2) alembic.ini의 sqlalchemy.url
#
# Docker / 개발용 구분하기 쉽게 환경변수를 최우선으로 둔다
def get_database_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url
    return config.get_main_option("sqlalchemy.url")


# ------------------------------------------------------------
# OFFLINE MODE (sql문만 출력)
# ------------------------------------------------------------
def run_migrations_offline() -> None:
    url = get_database_url()

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


# ------------------------------------------------------------
# ONLINE MODE (실제 DB에 연결)
# ------------------------------------------------------------
def run_migrations_online() -> None:
    url = get_database_url()

    connectable = create_engine(
        url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,        # 컬럼 타입 비교
            compare_server_default=True,
            compare_nullable=True,
        )

        with context.begin_transaction():
            context.run_migrations()


# ------------------------------------------------------------
# 실행 분기
# ------------------------------------------------------------
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
