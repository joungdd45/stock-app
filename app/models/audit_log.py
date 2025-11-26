# 📄 C:\dev\stock-app\app\models\audit_log.py
from __future__ import annotations

from typing import Any
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import BigInteger, String, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    # PK
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # 핵심 필드
    hash: Mapped[str] = mapped_column(String(128), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # 부가 정보 JSON
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # 생성 시각 (DB 서버 기본값)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("NOW()"),
        nullable=False,
    )

    # 마이그레이션과 동일한 인덱스 정의
    __table_args__ = (
        sa.Index("ix_audit_log_action_created_at", "action", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<AuditLog id={self.id} action={self.action} actor={self.actor}>"
