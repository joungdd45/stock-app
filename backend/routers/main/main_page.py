# 📄 backend/routers/main/main_page.py
# 페이지: 메인 페이지(MainPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v1.1 (DB 세션 연결 + 동기 서비스 연동) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/캘린더 생성 로직은 서비스에서만 처리
# - 파일명=라우터명=tags 통일: main-page

from __future__ import annotations
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.main.main_page_service import MainPageService
from backend.db.session import get_sync_session  # ✅ 실제 DB 세션 DI
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "main.page"
PAGE_VERSION = "v1.0"

ROUTE_PREFIX = "/api/main/page"
ROUTE_TAGS = ["main-page"]

main_page = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["main_page"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> MainPageService:
    return MainPageService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼 — 라우터 전용
# ─────────────────────────────────────────────────────────
class ResponseBase(BaseModel):
    ok: bool = True
    trace_id: Optional[str] = Field(default=None)


class ActionData(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(ResponseBase):
    data: ActionData


class PingResponse(ResponseBase):
    page: str
    version: str
    stage: str


# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@main_page.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 메인페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="skeleton",
    )

# ─────────────────────────────────────────────────────────
# 1) 요약 정보 summary
# ─────────────────────────────────────────────────────────
@main_page.get(
    "/summary",
    response_model=ActionResponse,
    summary="[read] 메인페이지 요약 정보 조회",
)
def get_summary(
    svc: MainPageService = Depends(get_service),
):
    try:
        result = svc.get_summary()
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2) 캘린더 calendar
# ─────────────────────────────────────────────────────────
@main_page.get(
    "/calendar",
    response_model=ActionResponse,
    summary="[read] 메인페이지 캘린더 조회",
)
def get_calendar(
    year: int = Query(..., description="연도"),
    month: int = Query(..., description="월 (1 to 12)"),
    svc: MainPageService = Depends(get_service),
):
    try:
        result = svc.get_calendar(year=year, month=month)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))
