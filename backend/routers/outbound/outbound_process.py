# 📄 backend/routers/outbound/outbound_process.py
# 페이지: 출고 처리(OutboundProcessPage)
# 역할: 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.1 (서비스 구현 버전 맞춤) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/상태처리/에러문구 생성/도메인 로직/반복분기 금지
# - 에러 형식과 HTTP코드는 전역 핸들러(error_codes.py)가 담당
# - 파일명=라우터명=tags 통일: outbound-process

from __future__ import annotations
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, conint

# 전역 에러 시스템
from backend.system.error_codes import DomainError

# 도메인 서비스 (클래스 기반)
from backend.services.outbound.outbound_process_service import OutboundProcessService

# 세션 / 인증 가드
from backend.db.session import get_sync_session
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.process"
PAGE_VERSION = "v2.1"

ROUTE_PREFIX = "/api/outbound/process"
ROUTE_TAGS = ["outbound-process"]

outbound_process = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["outbound_process"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session=Depends(get_sync_session),
) -> OutboundProcessService:
    """
    출고처리 서비스 DI.
    - 실제 DB 세션/모델 + 현재 사용자 정보를 주입한다.
    """
    return OutboundProcessService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼 — 라우터 전용 (입고처리 구조와 동일)
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
# 도메인 전용 DTO — 요청 스키마 중심 (문서화용)
# ─────────────────────────────────────────────────────────
class ScanRequest(BaseModel):
    invoice_no: str = Field(..., description="송장번호")
    barcode: str = Field(..., description="상품 바코드")


class WeightRequest(BaseModel):
    invoice_no: str = Field(..., description="송장번호")
    weight_g: conint(ge=1) = Field(..., description="포장 중량(g), 1 이상 정수")


class ConfirmRequest(BaseModel):
    invoice_no: str = Field(..., description="송장번호")

# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@outbound_process.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 출고 처리 페이지 헬스 체크",
)
def ping():
    """
    Swagger 노출 및 페이지 메타 정보 확인용 핑.
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="service-ready",
    )

# ─────────────────────────────────────────────────────────
# 1) 송장 로드: load_invoice
# ─────────────────────────────────────────────────────────
@outbound_process.get(
    "/invoice/{invoiceNo}",
    response_model=ActionResponse,
    summary="[read] 송장 품목 로드",
    responses={
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
async def load_invoice(
    invoiceNo: str,
    svc: OutboundProcessService = Depends(get_service),
):
    """
    송장번호 기준으로 출고 전표 + 아이템 목록 로드.
    라우터는 invoiceNo를 파싱해서 서비스에 전달하고,
    서비스 결과를 공통 응답 포맷으로 래핑만 한다.
    """
    try:
        result = await svc.load_invoice(invoice_no=invoiceNo)
    except DomainError as exc:
        # 전역 핸들러가 응답 포맷/HTTP코드를 책임지므로 그대로 전달
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2) 상품 스캔(+1): scan_item
# ─────────────────────────────────────────────────────────
@outbound_process.post(
    "/scan",
    response_model=ActionResponse,
    summary="[write] 상품 바코드 스캔(+1)",
    responses={
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
async def scan_item(
    payload: ScanRequest,
    svc: OutboundProcessService = Depends(get_service),
):
    """
    단일 바코드 스캔 처리.
    - invoice_no + barcode만 받아서 서비스로 전달.
    - 수량/상태 검증, 스캔 수량 증가 로직은 서비스에서 처리.
    """
    try:
        result = await svc.scan_item(
            invoice_no=payload.invoice_no,
            barcode=payload.barcode,
        )
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 3) 중량 설정(g): set_weight
# ─────────────────────────────────────────────────────────
@outbound_process.post(
    "/weight",
    response_model=ActionResponse,
    summary="[write] 중량 설정(g)",
    responses={
        404: {"description": "NOTFOUND"},
        422: {"description": "VALID"},
    },
)
async def set_weight(
    payload: WeightRequest,
    svc: OutboundProcessService = Depends(get_service),
):
    """
    포장 완료 후 박스 실중량(그램)을 저장.
    - 1g 미만/잘못된 형식 검증은 서비스에서 처리.
    """
    try:
        result = await svc.set_weight(
            invoice_no=payload.invoice_no,
            weight_g=payload.weight_g,
        )
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 4) 출고 확정: confirm_outbound
# ─────────────────────────────────────────────────────────
@outbound_process.post(
    "/confirm",
    response_model=ActionResponse,
    summary="[write] 출고 확정",
    responses={
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
async def confirm_outbound(
    payload: ConfirmRequest,
    svc: OutboundProcessService = Depends(get_service),
):
    """
    출고 확정.
    - 스캔 수량 일치 여부, 상태 검증, 재고/수불 반영, 상태 변경/커밋은 서비스에서 수행.
    """
    try:
        result = await svc.confirm_outbound(invoice_no=payload.invoice_no)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 5) 진행 상태 조회: get_state
# ─────────────────────────────────────────────────────────
@outbound_process.get(
    "/state/{invoiceNo}",
    response_model=ActionResponse,
    summary="[read] 진행 상태 조회",
    responses={
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
async def get_state(
    invoiceNo: str,
    svc: OutboundProcessService = Depends(get_service),
):
    """
    출고 진행상태 요약 조회.
    - 전체 수량 / 스캔 수량 / 일치 여부 / 중량 / 상태 요약 등은
      서비스에서 계산해서 dict로 반환.
    """
    try:
        result = await svc.get_state(invoice_no=invoiceNo)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))
