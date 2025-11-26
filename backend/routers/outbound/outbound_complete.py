# 📄 backend/routers/outbound/outbound_complete.py
# 페이지: 출고 완료(OutboundCompletePage)
# 역할: 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.1 (ping / list / export / cancel) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/상태처리/에러문구 생성/도메인 로직/반복분기 금지
# - 에러 형식과 HTTP코드는 전역 핸들러(error_codes.py)가 담당
# - 파일명=라우터명=tags 통일: outbound-complete

from __future__ import annotations
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from backend.system.error_codes import DomainError
from backend.services.outbound.outbound_complete_service import (
    OutboundCompleteService,
)
from backend.db.session import get_sync_session  # ✅ 실제 DB 세션 DI
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.complete"
PAGE_VERSION = "v2.1"

ROUTE_PREFIX = "/api/outbound/complete"
ROUTE_TAGS = ["outbound-complete"]

outbound_complete = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["outbound_complete"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session=Depends(get_sync_session),
) -> OutboundCompleteService:
    """
    서비스 DI.
    - 실제 DB 세션과 현재 사용자 정보를 주입한다.
    - 테스트 시 여기서 Mock 교체 가능.
    """
    return OutboundCompleteService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼 — 라우터 전용
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
# 도메인 전용 DTO — 출고 완료 전용 스키마
# ─────────────────────────────────────────────────────────
class CancelRequest(BaseModel):
    ids: List[int] = Field(..., description="출고취소할 outbound_item.id 목록")
    reason: Optional[str] = Field(
        default=None,
        description="출고취소 사유(선택)",
    )


class ExportRequest(BaseModel):
    ids: List[int] = Field(..., description="엑셀로 내보낼 outbound_item.id 목록")

# ─────────────────────────────────────────────────────────
# 1) [system] 핑
# ─────────────────────────────────────────────────────────
@outbound_complete.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 출고 완료 페이지 헬스 체크",
)
def ping():
    """
    Swagger 노출 및 페이지 메타 정보 확인용 핑.
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+service+db",
    )

# ─────────────────────────────────────────────────────────
# 2) 목록 조회 — list
# ─────────────────────────────────────────────────────────
@outbound_complete.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 출고 완료 목록 조회",
    responses={
        422: {"description": "VALID (OUTBOUND-VALID-001)"},
        500: {"description": "SYSTEM 에러"},
    },
)
async def list_completed(
    from_date: Optional[str] = Query(
        default=None,
        description="출고일자 시작(YYYY-MM-DD)",
    ),
    to_date: Optional[str] = Query(
        default=None,
        description="출고일자 종료(YYYY-MM-DD)",
    ),
    q: Optional[str] = Query(
        default=None,
        description="검색어(국가, 주문번호, 트래킹번호, SKU, 상품명 중 하나)",
    ),
    page: int = Query(
        default=1,
        description="페이지 번호(1부터)",
    ),
    size: int = Query(
        default=25,
        description="페이지 크기",
    ),
    sort_by: Optional[str] = Query(
        default="outbound_date",
        description=(
            "정렬 기준 필드"
            "(outbound_date, country, order_number, "
            "tracking_number, sku, product_name)"
        ),
    ),
    sort_dir: Optional[str] = Query(
        default="desc",
        description="정렬 방향(asc, desc)",
    ),
    svc: OutboundCompleteService = Depends(get_service),
):
    """
    출고 완료 상태의 목록을 조회하는 엔드포인트.
    - 모든 파라미터는 쿼리스트링(query) 기반.
    - 라우터는 파라미터만 받아서 서비스에 위임.
    """
    try:
        result = await svc.list_items(
            from_date=from_date,
            to_date=to_date,
            q=q,
            page=page,
            size=size,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 3) 선택 행 엑셀 내보내기 — export
# ─────────────────────────────────────────────────────────
@outbound_complete.post(
    "/export",
    response_model=ActionResponse,
    summary="[read] 출고 완료 선택 행 xlsx 내보내기",
    responses={
        422: {"description": "VALID (OUTBOUND-VALID-001)"},
        500: {"description": "SYSTEM 에러 (엑셀 생성 실패 등)"},
    },
)
async def export_completed(
    payload: ExportRequest,
    svc: OutboundCompleteService = Depends(get_service),
):
    """
    선택된 출고 완료 행들만 엑셀(xlsx)로 내보내는 엔드포인트.
    - 서비스에서 base64 인코딩된 내용을 반환하면,
      프론트에서 이를 디코딩해 파일 다운로드 처리한다.
    """
    try:
        result = await svc.export_items(payload=payload.dict())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 4) 출고취소 — cancel (서비스에서 아직 미구현)
# ─────────────────────────────────────────────────────────
@outbound_complete.post(
    "/cancel",
    response_model=ActionResponse,
    summary="[write] 출고 완료 행 출고취소(한 건, 현재 미구현)",
    responses={
        404: {"description": "NOTFOUND (OUTBOUND-NOTFOUND-101)"},
        409: {"description": "STATE (OUTBOUND-STATE-451)"},
        422: {"description": "VALID (OUTBOUND-VALID-001)"},
    },
)
async def cancel_completed(
    payload: CancelRequest,
    svc: OutboundCompleteService = Depends(get_service),
):
    """
    출고 완료 상태의 품목들을 출고취소로 되돌리는 엔드포인트.
    - 현재 서비스에서 미구현(OUTBOUND-DISABLED-402) 상태.
    """
    try:
        result = await svc.cancel_items(payload=payload.dict())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))
