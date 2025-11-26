# 📄 backend/routers/reports/reports_monthly.py
# 페이지: 대시보드 - 월간현황(MonthlyPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 공통 응답 래핑
# 단계: v2.0 (get_sync_session + 서비스 연결 완료)
#
# PAGE_ID: "reports.monthly"

from __future__ import annotations

from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.system.error_codes import DomainError
from backend.services.reports.reports_monthly_service import ReportsMonthlyService
from backend.db.session import get_sync_session  # ✅ 실제 동기 DB 세션
from backend.security.guard import guard  # ✅ 공통 인증 가드

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "reports.monthly"
PAGE_VERSION = "v2.0"

ROUTE_PREFIX = "/api/reports/monthly"
ROUTE_TAGS = ["reports-monthly"]

reports_monthly = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["reports_monthly"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session=Depends(get_sync_session),
) -> ReportsMonthlyService:
    """
    동기 DB 세션 + 현재 사용자 정보를 주입한 서비스 인스턴스 DI.
    """
    return ReportsMonthlyService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼
# ─────────────────────────────────────────────────────────
class ResponseBase(BaseModel):
    ok: bool = True
    trace_id: Optional[str] = Field(default=None, description="요청 추적용 ID")


class ActionData(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(ResponseBase):
    data: ActionData


class PingResponse(ResponseBase):
    page: str
    version: str
    stage: str


# ─────────────────────────────────────────────────────────
# 도메인 전용 DTO — 월간현황용 요청 스키마
# ─────────────────────────────────────────────────────────
class MonthlyListQuery(BaseModel):
    year: int = Field(..., description="조회 연도 예: 2025")
    month: int = Field(..., ge=1, le=12, description="조회 월 1 to 12")
    q: Optional[str] = Field(default=None, description="검색어 SKU 또는 상품명")
    page: int = Field(default=1, ge=1, description="페이지 번호 1부터")
    size: int = Field(default=10, ge=1, description="페이지 크기")


# ─────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────
def _validate_year_month(year: int, month: int):
    if year < 2000 or year > 2100:
        raise DomainError(
            "REPORTS-VALID-001",
            detail="조회 연도가 올바르지 않습니다.",
            ctx={"year": year},
            stage="router",
            domain=PAGE_ID,
        )
    if month < 1 or month > 12:
        raise DomainError(
            "REPORTS-VALID-002",
            detail="조회 월이 올바르지 않습니다.",
            ctx={"month": month},
            stage="router",
            domain=PAGE_ID,
        )


# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@reports_monthly.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 대시보드 월간현황 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )


# ─────────────────────────────────────────────────────────
# 1) 월간 출고현황 목록 조회 — list_monthly
# ─────────────────────────────────────────────────────────
@reports_monthly.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 월간 출고현황 목록 조회",
    responses={422: {"description": "VALID"}},
)
def list_monthly(
    year: int,
    month: int,
    q: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    svc: ReportsMonthlyService = Depends(get_service),
):
    """
    월간 출고현황 목록 조회.

    - inventory_ledger 기준 OUTBOUND 이력 집계
    - product 와 JOIN하여 상품명 포함
    - 출고수량 내림차순 정렬
    - 순위는 프론트에서 index 기반으로 계산
    """
    _validate_year_month(year, month)

    result = svc.list_items(
        year=year,
        month=month,
        q=q,
        page=page,
        size=size,
    )

    return ActionResponse(
        ok=True,
        data=ActionData(result=result),
    )


# ─────────────────────────────────────────────────────────
# 2) 월간 출고현황 엑셀 내보내기 — export_monthly
# ─────────────────────────────────────────────────────────
@reports_monthly.get(
    "/export",
    response_model=ActionResponse,
    summary="[export] 월간 출고현황 엑셀 내보내기",
    responses={422: {"description": "VALID"}, 500: {"description": "UNKNOWN"}},
)
def export_monthly(
    year: int,
    month: int,
    q: Optional[str] = None,
    svc: ReportsMonthlyService = Depends(get_service),
):
    """
    월간 출고현황 엑셀 다운로드.

    - 같은 집계 로직을 사용하되 페이징 없이 전체 데이터 반환
    - 결과는 base64 인코딩된 xlsx 정보로 래핑
    """
    _validate_year_month(year, month)

    result = svc.export_xlsx(
        year=year,
        month=month,
        q=q,
    )

    return ActionResponse(
        ok=True,
        data=ActionData(result=result),
    )
