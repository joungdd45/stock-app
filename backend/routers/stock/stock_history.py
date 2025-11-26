# 📄 backend/routers/stock/stock_history.py
# 페이지: 재고 이력(HistoryPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v1.3 (실제 DB 세션 + 공용 guard 연동 완료)
# PAGE_ID: stock.history
# PAGE_VERSION: v1.3

from __future__ import annotations
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.stock.stock_history_service import StockHistoryService
from backend.db.session import get_sync_session  # ✅ 실제 DB 세션
from backend.security.guard import guard        # ✅ 공용 인증/권한 가드

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "stock.history"
PAGE_VERSION = "v1.3"

ROUTE_PREFIX = "/api/stock/history"
ROUTE_TAGS = ["stock-history"]

stock_history = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["stock_history"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user: Dict[str, Any] = Depends(guard),
    session: Session = Depends(get_sync_session),   # ✅ 여기서 실제 세션 주입
) -> StockHistoryService:
    """
    서비스 DI.
    - 공용 guard에서 인증된 사용자 정보(user)를 받고,
    - get_sync_session으로 동기 DB 세션을 주입한다.
    """
    return StockHistoryService(session=session, user=user)

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
# [system] 핑
# ─────────────────────────────────────────────────────────
@stock_history.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+service+db",
    )

# ─────────────────────────────────────────────────────────
# 1) 재고 이력 목록 조회
# ─────────────────────────────────────────────────────────
@stock_history.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 재고 이력 목록 조회",
)
async def list_items(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sku: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    svc: StockHistoryService = Depends(get_service),
):
    try:
        result = await svc.list_items(
            from_date=from_date,
            to_date=to_date,
            sku=sku,
            keyword=keyword,
            page=page,
            size=size,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2) 엑셀 내보내기
# ─────────────────────────────────────────────────────────
@stock_history.get(
    "/export",
    response_model=ActionResponse,
    summary="[read] 재고 이력 엑셀 내보내기",
)
async def export_items(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sku: Optional[str] = None,
    keyword: Optional[str] = None,
    svc: StockHistoryService = Depends(get_service),
):
    try:
        result = await svc.export_items(
            from_date=from_date,
            to_date=to_date,
            sku=sku,
            keyword=keyword,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
