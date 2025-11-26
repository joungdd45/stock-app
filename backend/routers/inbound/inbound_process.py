# 📄 backend/routers/inbound/inbound_process.py
# 페이지: 입고 처리(inbound.process) — 바코드 스캔/등록/수량지정/입고확정
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷
# 단계: v5.0 (서비스 v5.0 기준 정합 완료)
# 규칙: 구조 통일 작업지침 v2 / 전체수정 원칙 적용

from __future__ import annotations

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.db.session import get_sync_session
from backend.services.inbound.inbound_process_service import InboundProcessService
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.process"
PAGE_VERSION = "v5.0"

ROUTE_PREFIX = "/api/inbound/process"
ROUTE_TAGS = ["inbound-process"]

inbound_process = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["inbound_process"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> InboundProcessService:
    return InboundProcessService(session=session, user=user)


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
# DTO
# ─────────────────────────────────────────────────────────
class ScanRequest(BaseModel):
    barcode: str


class RegisterBarcodeRequest(BaseModel):
    barcode: str
    sku: str
    # name은 모달에서 보여주기용이지만, 실제 등록은 sku 기준으로 처리
    name: Optional[str] = None


class SetQtyRequest(BaseModel):
    sku: str
    qty: Any


class ConfirmItem(BaseModel):
    item_id: int
    sku: str
    qty: Any


class ConfirmRequest(BaseModel):
    header_id: int
    items: List[ConfirmItem]
    operator: str


# ─────────────────────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────────────────────
@inbound_process.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 입고처리 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",  # scan / register-barcode / set-qty / confirm 구현
    )


@inbound_process.post(
    "/scan",
    response_model=ActionResponse,
    summary="[read] 바코드 스캔 → 상품 확인",
)
async def scan_barcode(
    payload: ScanRequest,
    svc: InboundProcessService = Depends(get_service),
):
    try:
        result = await svc.scan_barcode(barcode=payload.barcode)
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


@inbound_process.post(
    "/register-barcode",
    response_model=ActionResponse,
    summary="[write] 바코드 등록 (SKU 기준 매핑)",
)
async def register_barcode(
    payload: RegisterBarcodeRequest,
    svc: InboundProcessService = Depends(get_service),
):
    try:
        result = await svc.register_barcode(
            barcode=payload.barcode,
            sku=payload.sku,
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

    if payload.name is not None:
        result.setdefault("name", payload.name)

    return ActionResponse(ok=True, data=ActionData(result=result))


@inbound_process.post(
    "/set-qty",
    response_model=ActionResponse,
    summary="[write] 수량 설정",
)
async def set_qty(
    payload: SetQtyRequest,
    svc: InboundProcessService = Depends(get_service),
):
    try:
        result = await svc.set_qty(sku=payload.sku, qty=payload.qty)
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


@inbound_process.post(
    "/confirm",
    response_model=ActionResponse,
    summary="[write] 입고 확정 (status 변경 + ledger/stock 반영)",
)
async def confirm(
    payload: ConfirmRequest,
    svc: InboundProcessService = Depends(get_service),
):
    """
    입고 확정 엔드포인트.

    요청 예시:
    {
      "header_id": 3,
      "items": [
        { "item_id": 3, "sku": "EXIST-BULK-001", "qty": 3 }
      ],
      "operator": "DJ"
    }
    """
    try:
        items_payload = [item.model_dump() for item in payload.items]
        result = await svc.confirm(
            header_id=payload.header_id,
            items=items_payload,
            operator=payload.operator,
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
