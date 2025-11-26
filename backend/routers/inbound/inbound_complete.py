# 📄 backend/routers/inbound/inbound_complete.py
# 페이지: 입고 완료(InboundCompletePage)
# 역할: 요청 수신 → 가드/세션 → 서비스 호출 → 응답 래핑
# 단계: v3.1 (조회 + 수정 + 삭제 + xlsx 다운로드 라우터 구현)
#
# PAGE_ID: inbound.complete

from __future__ import annotations

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.inbound.inbound_complete_service import InboundCompleteService
from backend.db.session import get_sync_session
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.complete"
PAGE_VERSION = "v3.1"

ROUTE_PREFIX = "/api/inbound/complete"
ROUTE_TAGS = ["inbound-complete"]

inbound_complete = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["inbound_complete"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> InboundCompleteService:
    return InboundCompleteService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼
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
# [system] ping
# ─────────────────────────────────────────────────────────
@inbound_complete.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )

# ─────────────────────────────────────────────────────────
# [read] 입고완료 목록 조회
# ─────────────────────────────────────────────────────────
@inbound_complete.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 입고완료 목록 조회",
)
async def list_items(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    size: int = 25,
    svc: InboundCompleteService = Depends(get_service),
):
    try:
        result = await svc.list_items(
            start_date=start_date,
            end_date=end_date,
            keyword=keyword,
            page=page,
            size=size,
        )
    except DomainError as exc:
        raise DomainError(
            exc.code,
            detail=exc.detail,
            ctx={**(exc.ctx or {}), "page_id": PAGE_ID},
            stage="router",
            domain=PAGE_ID,
            trace_id=exc.trace_id,
        )

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# DTO — 수정/삭제/xlsx 전용
# ─────────────────────────────────────────────────────────
class UpdateRequest(BaseModel):
    """
    입고완료 단건 수정 요청
    - item_id 기준으로 수정
    - qty / total_price / unit_price / inbound_date / supplier_name 중
      필요한 필드만 선택적으로 보냄
    """
    item_id: int = Field(..., description="inbound_item의 ID")
    qty: Optional[int] = Field(default=None, description="입고 수량")
    total_price: Optional[float] = Field(default=None, description="총 단가")
    unit_price: Optional[float] = Field(default=None, description="개당 단가")
    inbound_date: Optional[str] = Field(
        default=None, description="입고일 YYYY-MM-DD"
    )
    supplier_name: Optional[str] = Field(
        default=None, description="입고처 이름"
    )


class DeleteRequest(BaseModel):
    """
    입고완료 다건 삭제 요청
    - 체크된 행들의 item_id 리스트
    """
    item_ids: List[int] = Field(..., description="삭제할 inbound_item ID 목록")


class ExportXlsxRequest(BaseModel):
    """
    입고완료 xlsx 다운로드 요청
    - 체크된 행들의 item_id 리스트
    """
    item_ids: List[int] = Field(..., description="엑셀로 내려받을 inbound_item ID 목록")

# ─────────────────────────────────────────────────────────
# [write] 입고완료 단건 수정
# ─────────────────────────────────────────────────────────
@inbound_complete.post(
    "/update",
    response_model=ActionResponse,
    summary="[write] 입고완료 단건 수정",
)
async def update_item(
    payload: UpdateRequest,
    svc: InboundCompleteService = Depends(get_service),
):
    try:
        result = await svc.update_item(
            item_id=payload.item_id,
            qty=payload.qty,
            total_price=payload.total_price,
            unit_price=payload.unit_price,
            inbound_date=payload.inbound_date,
            supplier_name=payload.supplier_name,
        )
    except DomainError as exc:
        raise DomainError(
            exc.code,
            detail=exc.detail,
            ctx={**(exc.ctx or {}), "page_id": PAGE_ID},
            stage="router",
            domain=PAGE_ID,
            trace_id=exc.trace_id,
        )

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# [write] 입고완료 다건 삭제
# ─────────────────────────────────────────────────────────
@inbound_complete.post(
    "/delete",
    response_model=ActionResponse,
    summary="[write] 입고완료 다건 삭제",
)
async def delete_items(
    payload: DeleteRequest,
    svc: InboundCompleteService = Depends(get_service),
):
    try:
        result = await svc.delete_items(item_ids=payload.item_ids)
    except DomainError as exc:
        raise DomainError(
            exc.code,
            detail=exc.detail,
            ctx={**(exc.ctx or {}), "page_id": PAGE_ID},
            stage="router",
            domain=PAGE_ID,
            trace_id=exc.trace_id,
        )

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# [download] 입고완료 xlsx 다운로드
# ─────────────────────────────────────────────────────────
@inbound_complete.post(
    "/export-xlsx",
    summary="[download] 입고완료 선택 항목 엑셀 다운로드(xlsx)",
)
async def export_xlsx(
    payload: ExportXlsxRequest,
    svc: InboundCompleteService = Depends(get_service),
):
    """
    체크된 입고완료 행들의 inbound_item ID 목록을 받아서
    xlsx 파일로 반환하는 엔드포인트.

    서비스 계약:
        content, filename = await svc.export_xlsx(item_ids=[...])
        - content: bytes 또는 BytesIO
        - filename: str (예: inbound-complete-2025-11-21.xlsx)
    """
    try:
        content, filename = await svc.export_xlsx(item_ids=payload.item_ids)
    except DomainError as exc:
        raise DomainError(
            exc.code,
            detail=exc.detail,
            ctx={**(exc.ctx or {}), "page_id": PAGE_ID},
            stage="router",
            domain=PAGE_ID,
            trace_id=exc.trace_id,
        )

    return StreamingResponse(
        content,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
