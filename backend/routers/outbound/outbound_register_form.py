# 📄 backend/routers/outbound/outbound_register_form.py
# 페이지: 출고등록 - 등록 탭 (OutboundRegisterFormPage)
# 역할: 프론트 출고등록 등록 탭 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.1 (라우터 + 서비스 연결 완료) / 헌법 v1.0 + 코딩 규약 v1.0 적용
#
# PAGE_ID: outbound.register.form

from __future__ import annotations
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.system.error_codes import DomainError
from backend.db.session import get_sync_session
from backend.security.guard import guard

# ─────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────
PAGE_ID = "outbound.register.form"
PAGE_VERSION = "v2.1"

ROUTE_PREFIX = "/api/outbound/register-form"
ROUTE_TAGS = ["outbound-register-form"]

outbound_register_form = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["outbound_register_form"]


# ─────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session=Depends(get_sync_session),
):
    try:
        from backend.services.outbound.outbound_register_form_service import (
            OutboundRegisterFormService,
        )
    except Exception as exc:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="출고등록 등록 서비스가 아직 준비되지 않았습니다.",
            ctx={
                "page_id": PAGE_ID,
                "reason": "SERVICE_IMPORT_FAILED",
                "exc": str(exc),
            },
            stage="router",
            domain=PAGE_ID,
        )

    return OutboundRegisterFormService(session=session, user=user)


# ─────────────────────────────────────────────
# 공통 응답 래퍼
# ─────────────────────────────────────────────
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


# ─────────────────────────────────────────────
# DTO — 출고등록 전용
# extra="ignore" → frontend에서 다른 필드가 섞여도 무시
# ─────────────────────────────────────────────
class OutboundRegisterItem(BaseModel):
    country: str = Field(..., description="국가 코드 (예: SG, MY, PH 등)")
    order_number: str = Field(..., description="쇼핑몰 주문번호")
    tracking_number: str = Field(..., description="트래킹번호")
    sku: str = Field(..., description="상품 SKU (product.sku)")
    product_name: str = Field(..., description="상품명 (표시용)")
    qty: int = Field(..., gt=0, description="출고수량 (1 이상)")
    total_price: float = Field(..., ge=0, description="해당 주문건 총 가격")

    model_config = {"extra": "ignore"}


class OutboundRegisterRequest(BaseModel):
    items: List[OutboundRegisterItem] = Field(
        ..., min_items=1, description="출고 등록 대상 행 목록"
    )

    model_config = {"extra": "ignore"}


# ─────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────
@outbound_register_form.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 출고등록 등록 탭 헬스 체크",
)
def ping() -> PingResponse:
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+service",
    )


# ─────────────────────────────────────────────
# [write] 출고 전표 일괄 등록 — register
# ─────────────────────────────────────────────
@outbound_register_form.post(
    "/register",
    response_model=ActionResponse,
    summary="[write] 출고 전표 일괄 등록 (등록 탭)",
    responses={
        422: {"description": "VALID 에러 (OUTBOUND-VALID-001 등)"},
        404: {"description": "NOTFOUND 에러"},
        409: {"description": "CONFLICT/STATE 에러"},
    },
)
async def register_outbound(
    payload: OutboundRegisterRequest,
    svc=Depends(get_service),
) -> ActionResponse:
    try:
        result = await svc.register(
            items=[item.model_dump() for item in payload.items]
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
