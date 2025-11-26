# 📄 backend/routers/inbound/inbound_register_form.py
# 페이지: 입고관리 - 입고등록 - 등록 탭 (InboundRegisterFormPage)
# 역할: 프론트 등록 탭에서 전송하는 입고 전표 + 라인 데이터를 접수하고
#       InboundRegisterFormService에 전달해 처리 결과를 래핑해 반환하는 진입점
# 단계: v2.0 (라우터 + 서비스 연결 완료)
# 규칙: 전체수정 / 라우터는 흐름·DTO·문서화만 담당 / 비즈니스 로직·DB 계산은 서비스로 위임
#
# 헌법 매핑:
# - PAGE_ID: inbound.register_form
# - 작업 순서: 1) 스펙 → 2) 라우터 스켈레톤 → 3) 서비스 스켈레톤
#              → 4) ✅ 연결(구현, 현재 단계) → 5) Swagger 검증

from __future__ import annotations

from typing import Optional, Dict, Any, List
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db.session import get_sync_session
from backend.services.inbound.inbound_register_form_service import (
    InboundRegisterFormService,
)
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.register_form"
PAGE_VERSION = "v2.0"

ROUTE_PREFIX = "/api/inbound/register-form"
ROUTE_TAGS = ["inbound-register-form"]

inbound_register_form = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["inbound_register_form"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> InboundRegisterFormService:
    """
    서비스 DI.
    - 동기 세션(get_sync_session)과 현재 사용자 정보를 주입해
      InboundRegisterFormService 인스턴스를 생성한다.
    """
    return InboundRegisterFormService(session=session, user=user)

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
# 도메인 전용 DTO — InboundRegisterForm 전용
# ─────────────────────────────────────────────────────────
class InboundRegisterFormItem(BaseModel):
    """
    입고등록 - 등록 탭에서 한 행(row)을 표현하는 DTO.

    화면 헤더:
    - 주문일자 / SKU / 상품명 / 입고 수량 / 총 단가 / 개당 단가 / 입고처
    """
    order_date: str = Field(
        ...,
        description="주문일자 (yyyymmdd 형식 문자열, 예: 20251120)",
        pattern=r"^\d{8}$",
    )
    sku: str = Field(
        ...,
        max_length=50,
        description="상품 SKU (product.sku, 필수)",
    )
    name: Optional[str] = Field(
        default=None,
        max_length=200,
        description="상품명 (표시용, 서버는 sku 기준으로만 검증)",
    )
    qty: int = Field(
        ...,
        gt=0,
        description="입고 수량 (1 이상 정수)",
    )
    total_price: Decimal = Field(
        ...,
        description="총 단가 (원가 기준, qty 합계 금액)",
    )
    unit_price: Optional[Decimal] = Field(
        default=None,
        description="개당 단가 (원가 기준, 프론트 표시용, 서버는 재계산)",
    )
    supplier_name: str = Field(
        ...,
        max_length=100,
        description="입고처(공급사 이름, inbound_header.supplier_name)",
    )
    memo: Optional[str] = Field(
        default=None,
        description="행 단위 메모 (전표 메모와 동일하게 취급 가능)",
    )


class InboundRegisterFormPayload(BaseModel):
    """
    입고 전표 + 라인 목록 전체를 한 번에 전달하는 요청 DTO.

    현재 스펙:
    - 한 행이 하나의 전표(inbound_header 1건 + inbound_item 1건)에 대응한다.
    - header 수준 필드는 서비스에서 행 단위 필드로부터 구성한다.
    """
    items: List[InboundRegisterFormItem] = Field(
        ...,
        min_items=1,
        description="입고 라인 목록 (각 행이 전표 1건에 대응)",
    )


class InboundRegisterFormCreatedItem(BaseModel):
    """
    서비스에서 반환하는 생성된 전표 요약 1건.
    """
    id: int = Field(..., description="생성된 inbound_header.id (주문번호 PK)")
    order_no: str = Field(..., description="표시용 주문번호 (YYYYMMDD-00001 형식)")
    order_date: str = Field(..., description="주문일자 (ISO yyyy-mm-dd)")
    supplier_name: str = Field(..., description="입고처 이름")
    sku: str = Field(..., description="상품 SKU")
    qty: int = Field(..., description="입고 수량")
    unit_price: float = Field(..., description="개당 단가")
    total_price: float = Field(..., description="총 단가")
    status: str = Field(..., description="전표 상태, 기본 draft")


class InboundRegisterFormSummary(BaseModel):
    count: int = Field(..., description="생성된 전표 수")
    total_qty: int = Field(..., description="전체 입고 수량 합계")
    total_amount: float = Field(..., description="전체 총단가 합계")


class InboundRegisterFormResult(BaseModel):
    """
    입고등록 성공 시 클라이언트에 내려주는 전체 결과 DTO.
    """
    page_id: str = Field(..., description="페이지 ID")
    page_version: str = Field(..., description="페이지 버전")
    created: List[InboundRegisterFormCreatedItem] = Field(
        ..., description="생성된 전표 목록"
    )
    summary: InboundRegisterFormSummary

# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@inbound_register_form.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 입고등록 - 등록 탭 헬스 체크",
)
def ping():
    """
    Swagger 노출 및 페이지 메타 정보 확인용 핑.
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="service",
    )

# ─────────────────────────────────────────────────────────
# [write] 입고 등록 — 전표 + 라인 생성
# ─────────────────────────────────────────────────────────
@inbound_register_form.post(
    "",
    response_model=ActionResponse,
    summary="[write] 입고 등록(전표 + 라인 생성)",
    responses={
        422: {"description": "VALID"},
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        500: {"description": "SYSTEM"},
    },
)
async def register_inbound_form(
    payload: InboundRegisterFormPayload,
    svc: InboundRegisterFormService = Depends(get_service),
):
    """
    입고관리 - 입고등록 - 등록 탭에서 사용하는 메인 쓰기 엔드포인트.

    흐름:
    1) DTO로 1차 형식 검증(order_date 형식, qty > 0 등)
    2) 서비스에 payload.dict()를 전달
    3) 서비스에서 도메인 규칙 검증 및 DB 반영
    4) 서비스 결과를 ActionResponse.data.result에 담아 반환
    """
    service_result: Dict[str, Any] = await svc.register_inbound_form(
        payload=payload.dict()
    )

    result_model = InboundRegisterFormResult(**service_result)

    return ActionResponse(
        ok=True,
        data=ActionData(result=result_model.dict()),
    )
