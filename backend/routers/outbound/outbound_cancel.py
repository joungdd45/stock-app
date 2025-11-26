# 📄 backend/routers/outbound/outbound_cancel.py
# 페이지: 출고 취소(OutboundCancelPage)
# 역할: 프론트 요청 수신 → 서비스 호출 → 결과 반환
# 단계: v1.1 / DB연결 + 서비스연결 완료 (생성자 인자명 수정)

from __future__ import annotations

from typing import Optional, Dict, Any, List
from datetime import date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session

from backend.db.session import get_sync_session
from backend.system.error_codes import DomainError
from backend.services.outbound.outbound_cancel_service import (
    OutboundCancelService,
    CancelFilter,
    Pagination,
)
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.cancel"
PAGE_VERSION = "v1.1"

ROUTE_PREFIX = "/api/outbound/cancel"
ROUTE_TAGS = ["outbound-cancel"]


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


outbound_cancel = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["outbound_cancel"]


# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> OutboundCancelService:
    return OutboundCancelService(
        db=session,               # ✅ 수정
        current_user=user,        # ✅ 수정
    )


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
# DTO
# ─────────────────────────────────────────────────────────
class ReOutboundRequest(BaseModel):
    header_ids: List[int] = Field(..., description="재출고 대상 outbound_header.id")
    action: str = Field(default="reissue", description="액션명 (reissue 고정)")


# ─────────────────────────────────────────────────────────
# [system] ping
# ─────────────────────────────────────────────────────────
@outbound_cancel.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="connected",
    )


# ─────────────────────────────────────────────────────────
# 1) 출고취소 목록 조회
# ─────────────────────────────────────────────────────────
@outbound_cancel.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 출고취소 목록 조회",
    responses={
        422: {"description": "VALID"},
    },
)
def list_cancelled_items(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = 1,
    size: int = 25,
    svc: OutboundCancelService = Depends(get_service),
):
    """
    취소된 출고 목록 조회
    - 기준: outbound_header.status = 'canceled'
    - 날짜: updated_at 기준
    """

    try:
        flt = CancelFilter(
            date_from=_parse_date(from_date),
            date_to=_parse_date(to_date),
        )

        pagination = Pagination(page=page, size=size)

        result = svc.list_canceled(
            flt=flt,
            pagination=pagination,
        )

    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ─────────────────────────────────────────────────────────
# 2) 재출고 (취소 → 출고등록 이동)
# ─────────────────────────────────────────────────────────
@outbound_cancel.post(
    "/reissue",
    response_model=ActionResponse,
    summary="[write] 출고취소 → 재출고",
    responses={
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
def reissue_outbound(
    payload: ReOutboundRequest,
    svc: OutboundCancelService = Depends(get_service),
):
    """
    취소된 출고전표를 다시 출고등록 상태로 되돌림

    - header 기준 1건만 허용
    - 기존 전표 복사 → draft 상태로 생성
    """

    if payload.action != "reissue":
        raise DomainError(
            code="OUTBOUND-CANCEL-ACTION-001",
            detail="올바르지 않은 action 입니다. action='reissue'만 허용됩니다.",
            ctx={"action": payload.action},
        )

    try:
        result = svc.reissue(header_ids=payload.header_ids)

    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ─────────────────────────────────────────────────────────
# 3) 엑셀 다운로드
# ─────────────────────────────────────────────────────────
@outbound_cancel.get(
    "/export",
    summary="[read] 출고취소 엑셀 다운로드",
)
def export_cancelled_items(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    header_ids: Optional[str] = None,
    svc: OutboundCancelService = Depends(get_service),
):
    """
    출고 취소 목록 엑셀 다운로드
    - 선택된 header가 있으면 해당 컬럼만
    - 없으면 필터 기준 전체 다운로드
    """

    ids: Optional[List[int]] = None

    if header_ids:
        try:
            ids = [int(i) for i in header_ids.split(",") if i.strip()]
        except ValueError:
            raise DomainError(
                code="OUTBOUND-CANCEL-VALID-003",
                detail="header_ids 형식이 올바르지 않습니다. 예: 1,2,3",
                ctx={"header_ids": header_ids},
            )

    flt = CancelFilter(
        date_from=_parse_date(from_date),
        date_to=_parse_date(to_date),
    )

    try:
        filename, content = svc.export_xlsx(
            flt=flt,
            header_ids=ids,
        )

    except DomainError as exc:
        raise exc

    return StreamingResponse(
        content=iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
