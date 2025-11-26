# 📄 backend/routers/inbound/inbound_register_query.py
# 페이지: 입고관리 - 입고 등록 - 조회(inboundRegisterQueryPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.0 (서비스 연결) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/상태처리/에러문구 생성/도메인 로직/반복분기 금지
# - 에러 형식과 HTTP코드는 전역 핸들러(error_codes.py)가 담당
# - 파일명=라우터명=tags 통일: inbound-register-query

from __future__ import annotations
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db.session import get_sync_session
from backend.system.error_codes import DomainError
from backend.services.inbound.inbound_register_query_service import (
    InboundRegisterQueryService,
)
from backend.security.guard import guard


# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.register.query"
PAGE_VERSION = "v2.0"

ROUTE_PREFIX = "/api/inbound/register/query"
ROUTE_TAGS = ["inbound-register-query"]

inbound_register_query = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["inbound_register_query"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> InboundRegisterQueryService:
    """
    서비스 DI.
    - 실제 DB 세션과 현재 사용자 정보를 주입한다.
    - 테스트 시 여기서 Mock 교체 가능.
    """
    return InboundRegisterQueryService(session=session, user=user)

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
# 도메인 전용 DTO — 요청 스키마 (설명용, 실제 쿼리는 함수 파라미터로 받음)
# ─────────────────────────────────────────────────────────
class ListQuery(BaseModel):
    """
    입고 등록 목록 조회 쿼리 파라미터 모델.
    주문일자 범위, 키워드, 페이지 정보를 담는다.
    (문서/예시용, FastAPI 쿼리 파라미터는 함수 시그니처에서 직접 정의)
    """
    date_from: Optional[str] = Field(default=None, description="주문일자 시작 (YYYY-MM-DD)")
    date_to: Optional[str] = Field(default=None, description="주문일자 종료 (YYYY-MM-DD)")
    keyword: Optional[str] = Field(default=None, description="SKU/상품명/입고처 검색어")
    page: int = Field(default=1, description="페이지 번호(1부터)")
    size: int = Field(default=10, description="페이지 크기")


class ItemQuery(BaseModel):
    """
    수정용 단건 조회에 사용하는 쿼리 모델 (문서용).
    """
    item_id: int = Field(..., description="대상 inbound_item.id")


class UpdateRequest(BaseModel):
    """
    입고 등록 한 건의 수량/단가 변경 요청.
    """
    item_id: int = Field(..., description="대상 inbound_item.id")
    qty: Optional[int] = Field(default=None, description="변경할 입고 수량")
    unit_price: Optional[float] = Field(default=None, description="변경할 개당 단가")

    class Config:
        json_schema_extra = {
            "example": {
                "item_id": 1,
                "qty": 120,
                "unit_price": 1300.0,
            }
        }


class DeleteRequest(BaseModel):
    """
    선택된 입고 등록 항목 삭제 요청.
    """
    item_ids: List[int] = Field(..., description="삭제 대상 inbound_item.id 목록")

    class Config:
        json_schema_extra = {
            "example": {
                "item_ids": [1, 2, 3],
            }
        }

# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@inbound_register_query.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 입고 등록 - 조회 페이지 헬스 체크",
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
# 1) 목록 조회 — list_items
# ─────────────────────────────────────────────────────────
@inbound_register_query.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 입고 등록 목록 조회",
    responses={
        422: {"description": "VALID: INBOUND-VALID-001"},
    },
)
async def list_items(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    svc: InboundRegisterQueryService = Depends(get_service),
):
    """
    입고 등록된 inbound_item 기준 목록 조회 엔드포인트.
    - 주문일자 범위, 키워드, 페이지 정보를 받아 서비스에 위임한다.
    """
    try:
        result = await svc.list_items(
            date_from=date_from,
            date_to=date_to,
            keyword=keyword,
            page=page,
            size=size,
        )
    except DomainError as exc:
        # 전역 에러 핸들러에서 처리하도록 그대로 전달
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2) 단건 조회 — get_item
# ─────────────────────────────────────────────────────────
@inbound_register_query.get(
    "/item",
    response_model=ActionResponse,
    summary="[read] 입고 등록 단건 조회(수정용)",
    responses={
        404: {"description": "NOTFOUND: INBOUND-NOTFOUND-101"},
        409: {"description": "STATE: INBOUND-STATE-451"},
        422: {"description": "VALID: INBOUND-VALID-001"},
    },
)
async def get_item(
    item_id: int,
    svc: InboundRegisterQueryService = Depends(get_service),
):
    """
    수정 버튼 클릭 시 사용할 단건 조회 엔드포인트.
    - inbound_item.id 기준으로 한 건을 조회한다.
    """
    try:
        result = await svc.get_item(item_id=item_id)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 3) 수정 — update_item
# ─────────────────────────────────────────────────────────
@inbound_register_query.post(
    "/update",
    response_model=ActionResponse,
    summary="[write] 입고 등록 수정",
    responses={
        404: {"description": "NOTFOUND: INBOUND-NOTFOUND-101"},
        409: {"description": "STATE: INBOUND-STATE-451"},
        422: {"description": "VALID: INBOUND-VALID-001"},
    },
)
async def update_item(
    payload: UpdateRequest,
    svc: InboundRegisterQueryService = Depends(get_service),
):
    """
    입고 등록 한 건의 수량/단가를 수정하는 엔드포인트.
    - 라우터는 입력 파싱과 서비스 호출, 응답 래핑만 담당한다.
    """
    try:
        result = await svc.update_item(payload=payload.dict())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 4) 삭제 — delete_items
# ─────────────────────────────────────────────────────────
@inbound_register_query.post(
    "/delete",
    response_model=ActionResponse,
    summary="[write] 입고 등록 삭제(soft delete)",
    responses={
        404: {"description": "NOTFOUND: INBOUND-NOTFOUND-101"},
        409: {"description": "STATE: INBOUND-STATE-451"},
        422: {"description": "VALID: INBOUND-VALID-001"},
    },
)
async def delete_items(
    payload: DeleteRequest,
    svc: InboundRegisterQueryService = Depends(get_service),
):
    """
    선택된 입고 등록 항목(inbound_item 행들)을 논리삭제하는 엔드포인트.
    - deleted_at, updated_by 등 실제 변경은 서비스에서 처리한다.
    """
    try:
        result = await svc.delete_items(item_ids=payload.item_ids)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))
