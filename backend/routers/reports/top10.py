# 📄 backend/routers/reports/top10.py
# 페이지: 대시보드 — TOP10 출고 현황
# 역할: 요청 수신 → 입력 파싱 → 서비스 호출 → 응답 래핑
# 단계: v2.1 (implemented + guard 주입) / 구조 통일 작업지침 v2 적용
# 규칙: 라우터는 계산·검증·조회·상태처리·DB 접근 금지

from __future__ import annotations
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.reports.top10_service import Top10Service
from backend.db.session import get_sync_session  # ✅ 실제 DB 세션 사용
from backend.security.guard import guard  # ✅ 공통 인증 가드

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "reports.top10"
PAGE_VERSION = "v2.1"

ROUTE_PREFIX = "/api/reports/top10"
ROUTE_TAGS = ["reports-top10"]

top10 = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["top10"]

# ─────────────────────────────────────────────────────────
# 의존성 (가드, 세션, 서비스 DI)
# ─────────────────────────────────────────────────────────
def get_service(
    user = Depends(guard),
    session: Session = Depends(get_sync_session),
) -> Top10Service:
    """
    TOP10 서비스 DI.
    - 공통 guard를 통해 인증된 user 주입
    - get_sync_session으로 동기 DB 세션 주입
    """
    return Top10Service(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼
# ─────────────────────────────────────────────────────────
class ResponseBase(BaseModel):
    ok: bool = True
    trace_id: Optional[str] = None


class ActionData(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(ResponseBase):
    data: ActionData


class PingResponse(ResponseBase):
    page: str
    version: str
    stage: str

# ─────────────────────────────────────────────────────────
# DTO — TOP10 조회용
# ─────────────────────────────────────────────────────────
class Top10ListQuery(BaseModel):
    year: int = Field(..., description="연도 (예: 2025)")
    month: int = Field(..., ge=1, le=12, description="월 (1~12)")
    keyword: Optional[str] = Field(default=None, description="SKU 또는 상품명 검색어")

# ─────────────────────────────────────────────────────────
# [system] ping
# ─────────────────────────────────────────────────────────
@top10.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] TOP10 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )

# ─────────────────────────────────────────────────────────
# [read] TOP10 목록 조회
# ─────────────────────────────────────────────────────────
@top10.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] TOP10 출고 목록 조회",
    responses={422: {"description": "VALID"}},
)
async def list_top10(
    year: int,
    month: int,
    keyword: Optional[str] = None,
    svc: Top10Service = Depends(get_service),
):
    try:
        result = await svc.list_top10(
            year=year,
            month=month,
            keyword=keyword,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ─────────────────────────────────────────────────────────
# [read] TOP10 엑셀 내보내기
# ─────────────────────────────────────────────────────────
@top10.get(
    "/export",
    response_model=ActionResponse,
    summary="[read] TOP10 엑셀 내보내기",
    responses={422: {"description": "VALID"}},
)
async def export_top10(
    year: int,
    month: int,
    keyword: Optional[str] = None,
    svc: Top10Service = Depends(get_service),
):
    try:
        result = await svc.export_top10(
            year=year,
            month=month,
            keyword=keyword,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
